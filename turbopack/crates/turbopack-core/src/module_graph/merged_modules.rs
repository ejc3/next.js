use std::collections::hash_map::Entry;

use anyhow::{Context, Result, bail};
use rustc_hash::{FxHashMap, FxHashSet};
use tracing::Instrument;
use turbo_tasks::{FxIndexMap, FxIndexSet, ResolvedVc, TryFlatJoinIterExt, TryJoinIterExt, Vc};

use crate::{
    chunk::{
        ChunkableModule, ChunkingType, MergeableModule, MergeableModuleExposure, MergeableModules,
        MergeableModulesExposed,
    },
    module::Module,
    module_graph::{
        GraphTraversalAction, ModuleGraph, RefData, chunk_group_info::RoaringBitmapWrapper,
    },
    resolve::ExportUsage,
};

#[turbo_tasks::value(transparent, cell = "keyed")]
#[allow(clippy::type_complexity)]
pub struct MergedModulesReplacements(
    FxHashMap<ResolvedVc<Box<dyn Module>>, Option<ResolvedVc<Box<dyn ChunkableModule>>>>,
);

#[turbo_tasks::value(transparent, cell = "keyed")]
#[allow(clippy::type_complexity)]
pub struct MergedModulesOriginalModules(
    FxHashMap<ResolvedVc<Box<dyn Module>>, ResolvedVc<Box<dyn Module>>>,
);

#[turbo_tasks::value]
pub struct MergedModuleInfo {
    /// A map of modules describing how they participate in module merging:
    /// - Not present: the module is not affected by merging and a regular chunk item should be
    ///   created for it.
    /// - Present with `Some(replacement)`: the module should be replaced with the given merged
    ///   module when creating a chunk item.
    /// - Present with `None`: the module is already included in some other merged module returned
    ///   by a `Some(replacement)` entry and no chunk item should be created for it.
    pub replacements: ResolvedVc<MergedModulesReplacements>,
    /// A map of replacement modules to their corresponding chunk group info (which is the same as
    /// the chunk group info of the original module it replaced).
    pub replacements_to_original: ResolvedVc<MergedModulesOriginalModules>,
}

impl MergedModuleInfo {
    /// Returns the merging decision for the given module:
    /// - `None`: the module is not affected by merging, keep it as-is.
    /// - `Some(None)`: the module is already included in another merged module, skip it.
    /// - `Some(Some(replacement))`: the module should be replaced with `replacement`.
    pub async fn should_replace_module(
        &self,
        module: ResolvedVc<Box<dyn Module>>,
    ) -> Result<Option<Option<ResolvedVc<Box<dyn ChunkableModule>>>>> {
        Ok(self.replacements.get(&module).await?.as_deref().copied())
    }

    /// Returns the original module for the given replacement module (useful for retrieving the
    /// chunk group info).
    pub async fn get_original_module(
        &self,
        module: ResolvedVc<Box<dyn Module>>,
    ) -> Result<Option<ResolvedVc<Box<dyn Module>>>> {
        Ok(self
            .replacements_to_original
            .get(&module)
            .await?
            .as_deref()
            .copied())
    }
}

/// Determine which modules can be merged together:
/// - if all chunks execute a sequence of modules in the same order, they can be merged together and
///   treated as one.
/// - if a merged module has an incoming edge not contained in the group, it has to expose its
///   exports into the module cache.
pub async fn compute_merged_modules(module_graph: Vc<ModuleGraph>) -> Result<Vc<MergedModuleInfo>> {
    let span_outer = tracing::info_span!(
        "compute merged modules",
        module_count = tracing::field::Empty,
        visit_count = tracing::field::Empty,
        merged_groups = tracing::field::Empty,
        included_modules = tracing::field::Empty
    );

    let span = span_outer.clone();
    async move {
        let async_module_info = module_graph.async_module_info();
        let chunk_group_info = module_graph.chunk_group_info().await?;
        let module_graph = module_graph.await?;

        let graphs = &module_graph.graphs;
        let module_count = graphs.iter().map(|g| g.graph.node_count()).sum::<usize>();
        span.record("module_count", module_count);

        // Use all entries from all graphs
        let entries = module_graph
            .all_chunk_group_entry_modules()
            .collect::<Vec<_>>();

        // Visit modules in topological order (importers before the modules they import, as far as
        // cycles allow), as bitmaps are propagated downwards. A module is then usually visited
        // once, after all of its importers, instead of once more every time another importer
        // reaches it. The resulting bitmaps (and so the grouping by bitmap below) are the same
        // fixed point in any order.
        let module_priority = module_graph.topological_priority(entries.iter().copied())?;
        let priority = |module: ResolvedVc<Box<dyn Module>>| -> Result<u32> {
            Ok(*module_priority
                .get(&module)
                .context("Module priority not found")?)
        };

        // For each module, the indices in the bitmap store which merge group entry modules
        // transitively import that module. The bitmap can be treated as an opaque value, merging
        // all modules with the same bitmap.
        let mut module_merged_groups: FxHashMap<ResolvedVc<Box<dyn Module>>, RoaringBitmapWrapper> =
            FxHashMap::with_capacity_and_hasher(module_count, Default::default());
        // Entries that started a new merge group for some deopt reason
        let mut entry_modules =
            FxHashSet::with_capacity_and_hasher(module_count, Default::default());

        let inner_span = tracing::info_span!("collect mergeable modules");
        let mergeable = module_graph
            .iter_reachable_modules()?
            .map(async |module| {
                if let Some(mergeable) =
                    ResolvedVc::try_downcast::<Box<dyn MergeableModule>>(module)
                    && *mergeable.is_mergeable().await?
                {
                    return Ok(Some(module));
                }
                Ok(None)
            })
            .try_flat_join()
            .instrument(inner_span)
            .await?
            .into_iter()
            .collect::<FxHashSet<_>>();

        // Pre-fetch async status for all mergeable modules using keyed access to avoid
        // reading the full AsyncModulesInfo set during the synchronous traversal below.
        let inner_span = tracing::info_span!("pre-fetch async module status");
        let async_modules: FxHashSet<_> = mergeable
            .iter()
            .map(async |&module| Ok(async_module_info.is_async(module).await?.then_some(module)))
            .try_flat_join()
            .instrument(inner_span)
            .await?
            .into_iter()
            .collect();

        let inner_span = tracing::info_span!("fixed point traversal").entered();

        let mut next_index = 0u32;
        let visit_count = module_graph.traverse_edges_fixed_point_with_priority(
            entries
                .iter()
                .map(|&e| Ok((e, priority(e)?)))
                .collect::<Result<Vec<_>>>()?,
            &mut (),
            |parent_info: Option<(ResolvedVc<Box<dyn Module>>, &'_ RefData, _)>,
             node: ResolvedVc<Box<dyn Module>>,
             _,
             _|
             -> Result<GraphTraversalAction> {
                // On the down traversal, establish which edges are mergeable and set the list
                // indices.
                let (parent_module, hoisted) =
                    parent_info.map_or((None, false), |(node, ty, _)| {
                        (
                            Some(node),
                            match &ty.chunking_type {
                                ChunkingType::Parallel { hoisted, .. } => *hoisted,
                                _ => false,
                            },
                        )
                    });
                let module = node;

                Ok(if parent_module.is_some_and(|p| p == module) {
                    // A self-reference
                    GraphTraversalAction::Skip
                } else if hoisted
                    && let Some(parent_module) = parent_module
                    && mergeable.contains(&parent_module)
                    && mergeable.contains(&module)
                    && !async_modules.contains(&parent_module)
                    && !async_modules.contains(&module)
                {
                    // ^ TODO technically we could merge a sync child into an async parent

                    // A hoisted reference from a mergeable module to a non-async mergeable
                    // module, inherit bitmaps from parent.
                    module_merged_groups.entry(node).or_default();
                    let [Some(parent_merged_groups), Some(current_merged_groups)] =
                        module_merged_groups.get_disjoint_mut([&parent_module, &node])
                    else {
                        // All modules are inserted in the previous iteration
                        bail!("unreachable except for eventual consistency");
                    };

                    if current_merged_groups.is_empty() {
                        // Initial visit, clone instead of merging
                        *current_merged_groups = parent_merged_groups.clone();
                        GraphTraversalAction::Continue
                    } else if parent_merged_groups.is_proper_superset(current_merged_groups) {
                        // Add bits from parent, and continue traversal because changed
                        **current_merged_groups |= &**parent_merged_groups;
                        GraphTraversalAction::Continue
                    } else {
                        // Unchanged, no need to forward to children
                        GraphTraversalAction::Skip
                    }
                } else {
                    // Either a non-hoisted reference or an incompatible parent or child module

                    if entry_modules.insert(module) {
                        // Not assigned a new group before, create a new one.
                        let idx = next_index;
                        next_index += 1;

                        if module_merged_groups.entry(module).or_default().insert(idx) {
                            // Mark and continue traversal because modified (or first visit)
                            GraphTraversalAction::Continue
                        } else {
                            // Unchanged, no need to forward to children
                            GraphTraversalAction::Skip
                        }
                    } else {
                        // Already visited and assigned a new group, no need to forward to
                        // children.
                        GraphTraversalAction::Skip
                    }
                })
            },
            |successor, _| priority(successor),
        )?;

        drop(inner_span);
        let inner_span = tracing::info_span!("chunk group collection").entered();

        span.record("visit_count", visit_count);

        // Below, modules are grouped by equal bitmaps, once per chunk group and once more for the
        // whole graph. Hashing or comparing a bitmap costs time proportional to its size, so give
        // every distinct bitmap a small id once and hash and compare the ids instead.
        let module_merged_group_ids: FxHashMap<ResolvedVc<Box<dyn Module>>, u32> = {
            let mut ids: FxHashMap<&RoaringBitmapWrapper, u32> =
                FxHashMap::with_capacity_and_hasher(module_merged_groups.len(), Default::default());
            module_merged_groups
                .iter()
                .map(|(module, bitmap)| {
                    let next_id = ids.len() as u32;
                    (*module, *ids.entry(bitmap).or_insert(next_id))
                })
                .collect()
        };
        drop(module_merged_groups);

        /// Where a module occurs: `(chunk group, list) -> entry`, the module being
        /// `lists[chunk group][list][entry]`. A module occurs at most once in a list.
        type ListOccurrences = FxIndexMap<(usize, usize), usize>;

        // A list of all different execution traces (orderings) of all modules, initially a union of
        // the partition of each chunk's modules (one for each ESM subtree in each chunks), but
        // further split up later on.
        // This is a list (one per chunk group, initially) of lists (one per ESM subtree) of modules
        let mut lists;
        let mut lists_reverse_indices: FxIndexMap<ResolvedVc<Box<dyn Module>>, ListOccurrences> =
            FxIndexMap::default();

        // Once we do the reconciliation below, we need to insert new lists, but the lists are per
        // chunk group, so we put them into this one.
        #[allow(non_snake_case)]
        let LISTS_COMMON_IDX: usize;

        // A map of all references between modules with the same bitmap. These are all references,
        // including reexecution edges and cycles. Used to expose additional modules if the
        // bitmap-groups are split up further.
        #[allow(clippy::type_complexity)]
        let mut intra_group_references: FxIndexMap<
            ResolvedVc<Box<dyn Module>>,
            FxIndexSet<ResolvedVc<Box<dyn Module>>>,
        > = FxIndexMap::default();
        // A map of all references between modules with the same bitmap. These are only the
        // references relevant for execution (ignoring cycles), to find the entries of a group.
        #[allow(clippy::type_complexity)]
        let mut intra_group_references_rev: FxIndexMap<
            ResolvedVc<Box<dyn Module>>,
            FxIndexSet<ResolvedVc<Box<dyn Module>>>,
        > = FxIndexMap::default();

        {
            struct ChunkGroupResult {
                first_chunk_group_idx: usize,
                #[allow(clippy::type_complexity)]
                list_lists: Vec<Vec<Vec<ResolvedVc<Box<dyn MergeableModule>>>>>,
                lists_reverse_indices: FxIndexMap<ResolvedVc<Box<dyn Module>>, ListOccurrences>,
                #[allow(clippy::type_complexity)]
                intra_group_references_rev: FxIndexMap<
                    ResolvedVc<Box<dyn Module>>,
                    FxIndexSet<ResolvedVc<Box<dyn Module>>>,
                >,
            }
            let span = tracing::info_span!("map chunk groups").entered();

            let result = turbo_tasks::parallel::map_collect_chunked_owned::<_, _, Result<Vec<_>>>(
                // TODO without collect
                chunk_group_info.chunk_groups.iter().enumerate().collect(),
                |chunk| {
                    let mut list_lists = vec![];
                    let mut lists_reverse_indices: FxIndexMap<
                        ResolvedVc<Box<dyn Module>>,
                        ListOccurrences,
                    > = FxIndexMap::default();
                    #[allow(clippy::type_complexity)]
                    let mut intra_group_references_rev: FxIndexMap<
                        ResolvedVc<Box<dyn Module>>,
                        FxIndexSet<ResolvedVc<Box<dyn Module>>>,
                    > = FxIndexMap::default();

                    let mut chunk = chunk.peekable();
                    let first_chunk_group_idx = chunk.peek().unwrap().0;

                    for (chunk_group_idx, chunk_group) in chunk {
                        let mut lists = vec![];

                        // A partition of all modules in the chunk into several execution traces
                        // (orderings), stored in the top-level lists and referenced here by
                        // index.
                        let mut chunk_lists: FxHashMap<u32, usize> =
                            FxHashMap::with_capacity_and_hasher(
                                module_merged_group_ids.len() / chunk_group_info.chunk_groups.len(),
                                Default::default(),
                            );

                        // This is necessary to have the correct order with cycles: a `a -> b -> a`
                        // graph would otherwise be visited as `b->a`, `a->b`,
                        // leading to the list `a, b` which is not execution order.
                        let mut visited = FxHashSet::default();

                        module_graph.traverse_edges_dfs(
                            chunk_group.entries(),
                            &mut (),
                            |parent_info, node, _| {
                                if parent_info.is_none_or(|(_, r)| r.chunking_type.is_parallel())
                                    && visited.insert(node)
                                {
                                    Ok(GraphTraversalAction::Continue)
                                } else {
                                    Ok(GraphTraversalAction::Exclude)
                                }
                            },
                            |parent_info, node, _| {
                                let module = node;
                                let bitmap = *module_merged_group_ids
                                    .get(&module)
                                    .context("every module should have a bitmap")?;

                                if mergeable.contains(&module) {
                                    let mergeable_module =
                                        ResolvedVc::try_downcast::<Box<dyn MergeableModule>>(
                                            module,
                                        )
                                        .context(
                                            "found mergeable module which is not a MergeableModule",
                                        )?;
                                    match chunk_lists.entry(bitmap) {
                                        Entry::Vacant(e) => {
                                            // New list, insert the module
                                            let idx = lists.len();
                                            e.insert(idx);
                                            lists.push(vec![mergeable_module]);
                                            lists_reverse_indices
                                                .entry(module)
                                                .or_default()
                                                .insert((chunk_group_idx, idx), 0);
                                        }
                                        Entry::Occupied(e) => {
                                            let list_idx = *e.get();
                                            let list = &mut lists[list_idx];
                                            list.push(mergeable_module);
                                            lists_reverse_indices
                                                .entry(module)
                                                .or_default()
                                                .insert(
                                                    (chunk_group_idx, list_idx),
                                                    list.len() - 1,
                                                );
                                        }
                                    }
                                }

                                if let Some((parent, _)) = parent_info {
                                    let same_bitmap = module_merged_group_ids
                                        .get(&parent)
                                        .context("every module should have a bitmap")?
                                        == module_merged_group_ids
                                            .get(&module)
                                            .context("every module should have a bitmap")?;

                                    if same_bitmap {
                                        intra_group_references_rev
                                            .entry(module)
                                            .or_default()
                                            .insert(parent);
                                    }
                                }
                                Ok(())
                            },
                            false,
                        )?;

                        list_lists.push(lists);
                    }
                    Ok(ChunkGroupResult {
                        first_chunk_group_idx,
                        list_lists,
                        lists_reverse_indices,
                        intra_group_references_rev,
                    })
                },
            )?;

            drop(span);
            let _span = tracing::info_span!("merging chunk group lists").entered();

            lists_reverse_indices
                .reserve_exact(result.iter().map(|r| r.lists_reverse_indices.len()).sum());
            intra_group_references_rev.reserve_exact(
                result
                    .iter()
                    .map(|r| r.intra_group_references_rev.len())
                    .sum(),
            );

            lists = vec![Default::default(); chunk_group_info.chunk_groups.len() + 1];
            LISTS_COMMON_IDX = result.len();
            for ChunkGroupResult {
                first_chunk_group_idx,
                list_lists: result_lists,
                lists_reverse_indices: result_lists_reverse_indices,
                intra_group_references_rev: result_intra_group_references_rev,
            } in result
            {
                lists.splice(
                    first_chunk_group_idx..(first_chunk_group_idx + result_lists.len()),
                    result_lists,
                );
                for (module, occurrences) in result_lists_reverse_indices {
                    lists_reverse_indices
                        .entry(module)
                        .or_default()
                        .extend(occurrences);
                }
                for (module, occurrences) in result_intra_group_references_rev {
                    intra_group_references_rev
                        .entry(module)
                        .or_default()
                        .extend(occurrences);
                }
            }
        }

        drop(inner_span);
        let inner_span = tracing::info_span!("exposed computation").entered();

        // We use list.pop() below, so reverse order using negation
        lists_reverse_indices.sort_by_cached_key(|_, b| b.values().min().map(|&v| -(v as i64)));

        // Modules that are referenced from outside the group, so their exports need to be exposed.
        // Initially these are set based on the bitmaps (and namespace imports), but more modules
        // might need to be exposed if the lists are split up further below.
        let mut exposed_modules_imported: FxHashSet<ResolvedVc<Box<dyn Module>>> =
            FxHashSet::with_capacity_and_hasher(module_merged_group_ids.len(), Default::default());
        let mut exposed_modules_namespace: FxHashSet<ResolvedVc<Box<dyn Module>>> =
            FxHashSet::with_capacity_and_hasher(module_merged_group_ids.len(), Default::default());

        module_graph.traverse_edges_dfs(
            entries,
            &mut (),
            |_, _, _| Ok(GraphTraversalAction::Continue),
            |parent_info, node, _| {
                let module = node;

                if let Some((parent, _)) = parent_info {
                    let same_bitmap = module_merged_group_ids
                        .get(&parent)
                        .context("every module should have a bitmap")?
                        == module_merged_group_ids
                            .get(&module)
                            .context("every module should have a bitmap")?;

                    if same_bitmap {
                        intra_group_references
                            .entry(parent)
                            .or_default()
                            .insert(module);
                    }
                }

                if match parent_info {
                    None => true,
                    Some((parent, _)) => {
                        module_merged_group_ids
                            .get(&parent)
                            .context("every module should have a bitmap")?
                            != module_merged_group_ids
                                .get(&module)
                                .context("every module should have a bitmap")?
                    }
                } {
                    // This module needs to be exposed:
                    // - referenced from another group or
                    // - an entry module (TODO assume it will be required for Node/Edge, but not
                    // necessarily needed for browser),
                    exposed_modules_imported.insert(module);
                }
                if parent_info.is_some_and(|(_, r)| {
                    matches!(
                        r.binding_usage.export,
                        ExportUsage::All
                            | ExportUsage::PartialNamespaceObject(_)
                            | ExportUsage::Passthrough { .. }
                    )
                }) {
                    // This module needs to be exposed:
                    // - namespace import from another group
                    exposed_modules_namespace.insert(module);
                }
                Ok(())
            },
            false,
        )?;

        drop(inner_span);
        let inner_span = tracing::info_span!("reconciliation").entered();
        // The modules referencing each module inside its group (`intra_group_references`
        // reversed).
        #[allow(clippy::type_complexity)]
        let mut intra_group_referrers: FxHashMap<
            ResolvedVc<Box<dyn Module>>,
            Vec<ResolvedVc<Box<dyn Module>>>,
        > = FxHashMap::default();
        for (&referrer, referenced) in &intra_group_references {
            for &module in referenced {
                intra_group_referrers
                    .entry(module)
                    .or_default()
                    .push(referrer);
            }
        }
        // Where each module that was already taken from `lists_reverse_indices` is: it occurs in
        // exactly one list, `(chunk group, list, entry)`, and does not move anymore (only the
        // modules after or in the common part of a split move, and their occurrences have to be
        // in `lists_reverse_indices`).
        let mut settled: FxHashMap<ResolvedVc<Box<dyn Module>>, (usize, usize, usize)> =
            FxHashMap::default();

        while let Some((module, common_occurrences)) = lists_reverse_indices.pop() {
            if common_occurrences.len() < 2 {
                // Module exists only in one list, no need to split
                if let Some((&(chunk_group, list), &entry)) = common_occurrences.first() {
                    settled.insert(module, (chunk_group, list, entry));
                }
                continue;
            }
            // The module occurs in multiple lists, which need to split up so that there is exactly
            // one list containing the module.

            let (&(first_chunk_group, first_list), &first_entry) = common_occurrences
                .first()
                .context("occurrences are not empty")?;

            // Find the longest common sequence in the lists, starting from the given module.
            let mut common_length = 2;
            loop {
                let m = lists[first_chunk_group][first_list].get(first_entry + common_length - 1);
                if m.is_some()
                    && common_occurrences
                        .iter()
                        .skip(1)
                        .all(|(&(chunk_group, list), &entry)| {
                            lists[chunk_group][list].get(entry + common_length - 1) == m
                        })
                {
                    common_length += 1;
                    continue;
                }

                // Went one too far, the common length is what the previous iteration verified
                common_length -= 1;
                break;
            }

            // Split into three lists:
            // - "common" [occurrence.entry .. occurrence.entry + common_length) -- same for all
            // - "before" [0 .. occurrence.entry)
            // - "after"  [occurrence.entry + common_length .. ]
            let common_list = lists[first_chunk_group][first_list]
                [first_entry..first_entry + common_length]
                .to_vec();

            let common_list_index = lists[LISTS_COMMON_IDX].len();
            lists[LISTS_COMMON_IDX].push(common_list.clone());
            settled.insert(module, (LISTS_COMMON_IDX, common_list_index, 0));

            // Insert occurrences for the "common" list, skip the first because that is now
            // guaranteed to exist only once
            for (i, &m) in common_list.iter().enumerate().skip(1) {
                let occurrences = lists_reverse_indices
                    .get_mut(&ResolvedVc::upcast(m))
                    .context("every module should have occurrences")?;
                for (&(chunk_group, list), &entry) in &common_occurrences {
                    let removed = occurrences.swap_remove(&(chunk_group, list));
                    debug_assert_eq!(removed, Some(entry + i));
                }
                occurrences.insert((LISTS_COMMON_IDX, common_list_index), i);
            }

            let common_set = common_list
                .iter()
                .map(|&m| ResolvedVc::upcast::<Box<dyn Module>>(m))
                .collect::<FxHashSet<_>>();

            // For all previously merged references (intra_group_references) that now cross
            // "before", "common" and "after" of one of the lists, mark the referenced modules as
            // exposed.
            // Note that due to circular dependencies, there can be
            // references that go against execution order (e.g. from "before" to
            // "common").
            //
            // Such a reference has an end in "common" or "after", so only the references of those
            // modules are looked at. Where the other end is in a list is looked up in its
            // occurrences (or, for a module already taken from `lists_reverse_indices`, its
            // settled position) instead of collecting "before", which can be long. A module that
            // is already exposed does not need to be looked up again.

            // A reference between a module in "common" and one outside of it crosses the split in
            // every list that holds both.
            let in_any_split_list = |m: ResolvedVc<Box<dyn Module>>| -> bool {
                if let Some(occurrences) = lists_reverse_indices.get(&m) {
                    if occurrences.len() < common_occurrences.len() {
                        occurrences
                            .keys()
                            .any(|key| common_occurrences.contains_key(key))
                    } else {
                        common_occurrences
                            .keys()
                            .any(|key| occurrences.contains_key(key))
                    }
                } else if let Some(&(chunk_group, list, _)) = settled.get(&m) {
                    common_occurrences.contains_key(&(chunk_group, list))
                } else {
                    false
                }
            };
            for &m in &common_list {
                let m = ResolvedVc::upcast::<Box<dyn Module>>(m);
                if !exposed_modules_imported.contains(&m)
                    && let Some(referrers) = intra_group_referrers.get(&m)
                    && referrers
                        .iter()
                        .any(|&r| !common_set.contains(&r) && in_any_split_list(r))
                {
                    exposed_modules_imported.insert(m);
                }
                if let Some(referenced) = intra_group_references.get(&m) {
                    for &r in referenced {
                        if !exposed_modules_imported.contains(&r)
                            && !common_set.contains(&r)
                            && in_any_split_list(r)
                        {
                            exposed_modules_imported.insert(r);
                        }
                    }
                }
            }

            for (&(chunk_group, list), &entry) in &common_occurrences {
                let after_list = lists[chunk_group][list].split_off(entry + common_length);
                lists[chunk_group][list].truncate(entry);

                // A reference between a module in "after" and one in "before" or "common" of this
                // list.
                {
                    let before_or_common = |m: ResolvedVc<Box<dyn Module>>| -> bool {
                        if common_set.contains(&m) {
                            return true;
                        }
                        let m_entry = if let Some(occurrences) = lists_reverse_indices.get(&m) {
                            occurrences.get(&(chunk_group, list)).copied()
                        } else {
                            settled
                                .get(&m)
                                .and_then(|&(m_chunk_group, m_list, m_entry)| {
                                    ((m_chunk_group, m_list) == (chunk_group, list))
                                        .then_some(m_entry)
                                })
                        };
                        m_entry.is_some_and(|m_entry| m_entry < entry)
                    };
                    for &m in &after_list {
                        let m = ResolvedVc::upcast::<Box<dyn Module>>(m);
                        if !exposed_modules_imported.contains(&m)
                            && let Some(referrers) = intra_group_referrers.get(&m)
                            && referrers.iter().any(|&r| before_or_common(r))
                        {
                            exposed_modules_imported.insert(m);
                        }
                        if let Some(referenced) = intra_group_references.get(&m) {
                            for &r in referenced {
                                if !exposed_modules_imported.contains(&r) && before_or_common(r) {
                                    exposed_modules_imported.insert(r);
                                }
                            }
                        }
                    }
                }

                // The occurrences for the "before" list (`list`) are still valid, need to update
                // the occurrences for the "after" list
                if !after_list.is_empty() {
                    let after_index = lists[LISTS_COMMON_IDX].len();
                    for (i, &m) in after_list.iter().enumerate() {
                        let Some(occurrences) =
                            lists_reverse_indices.get_mut(&ResolvedVc::upcast(m))
                        else {
                            bail!("Couldn't find module in reverse list");
                        };

                        let removed = occurrences.swap_remove(&(chunk_group, list));
                        debug_assert_eq!(removed, Some(entry + common_length + i));

                        occurrences.insert((LISTS_COMMON_IDX, after_index), i);
                    }
                    lists[LISTS_COMMON_IDX].push(after_list);
                }
            }
        }

        // Dedupe the lists
        let lists = lists.into_iter().flatten().collect::<FxHashSet<_>>();

        drop(inner_span);
        let inner_span = tracing::info_span!("merging");
        // Call MergeableModule impl to merge the modules.
        let result = lists
            .into_iter()
            .map(async |list| {
                if list.len() < 2 {
                    // Nothing to merge
                    return Ok(None);
                }

                let list_set = list
                    .iter()
                    .map(|&m| ResolvedVc::upcast::<Box<dyn Module>>(m))
                    .collect::<FxIndexSet<_>>();

                let entry_points = list
                    .iter()
                    .filter(|m| {
                        intra_group_references_rev
                            .get(&ResolvedVc::upcast(**m))
                            .is_none_or(|refs| refs.is_disjoint(&list_set))
                    })
                    .map(|m| **m)
                    .collect::<Vec<_>>();
                debug_assert_ne!(entry_points.len(), 0);

                let list_exposed = list
                    .iter()
                    .map(|&m| {
                        (
                            m,
                            if exposed_modules_imported.contains(&ResolvedVc::upcast(m)) {
                                MergeableModuleExposure::External
                            } else if exposed_modules_namespace.contains(&ResolvedVc::upcast(m)) {
                                MergeableModuleExposure::Internal
                            } else {
                                MergeableModuleExposure::None
                            },
                        )
                    })
                    .collect::<Vec<_>>();

                let entry = *list.last().unwrap();
                let result = entry
                    .merge(
                        MergeableModulesExposed::interned(list_exposed),
                        MergeableModules::interned(entry_points),
                    )
                    .to_resolved()
                    .await?;

                let list_len = list.len();
                Ok(Some((
                    ResolvedVc::upcast::<Box<dyn Module>>(entry),
                    result,
                    list.into_iter()
                        .take(list_len - 1)
                        .map(ResolvedVc::upcast::<Box<dyn Module>>)
                        .collect::<Vec<_>>(),
                )))
            })
            .try_join()
            .instrument(inner_span)
            .await?;

        #[allow(clippy::type_complexity)]
        let mut replacements: FxHashMap<
            ResolvedVc<Box<dyn Module>>,
            Option<ResolvedVc<Box<dyn ChunkableModule>>>,
        > = Default::default();
        #[allow(clippy::type_complexity)]
        let mut replacements_to_original: FxHashMap<
            ResolvedVc<Box<dyn Module>>,
            ResolvedVc<Box<dyn Module>>,
        > = Default::default();
        let mut merged_groups = 0;
        let mut included_modules = 0;

        for (original, replacement, replacement_included) in result.into_iter().flatten() {
            replacements.insert(original, Some(replacement));
            replacements_to_original.insert(ResolvedVc::upcast(replacement), original);
            merged_groups += 1;
            included_modules += replacement_included.len();
            for included in replacement_included {
                replacements.insert(included, None);
            }
        }

        span.record("merged_groups", merged_groups);
        span.record("included_modules", included_modules);

        Ok(MergedModuleInfo {
            replacements: ResolvedVc::cell(replacements),
            replacements_to_original: ResolvedVc::cell(replacements_to_original),
        }
        .cell())
    }
    .instrument(span_outer)
    .await
}

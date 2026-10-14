use std::{
    hash::Hash,
    ops::{Deref, DerefMut},
    sync::LazyLock,
};

use anyhow::{Context, Result, bail};
use bincode::{Decode, Encode};
use either::Either;
use indexmap::map::Entry;
use roaring::RoaringBitmap;
use rustc_hash::FxHashMap;
use tracing::Instrument;
use turbo_rcstr::RcStr;
use turbo_tasks::{
    FxIndexMap, FxIndexSet, NonLocalValue, ResolvedVc, TaskInput, TryJoinIterExt, ValueToString,
    Vc, debug::ValueDebugFormat, turbofmt,
};

use crate::{
    chunk::ChunkingType,
    module::Module,
    module_graph::{GraphTraversalAction, ModuleGraph, RefData},
};

#[derive(Clone, Debug, Default, PartialEq, ValueDebugFormat, Encode, Decode)]
#[repr(transparent)]
pub struct RoaringBitmapWrapper(#[bincode(with_serde)] pub RoaringBitmap);

impl TaskInput for RoaringBitmapWrapper {
    fn is_transient(&self) -> bool {
        false
    }
}

impl RoaringBitmapWrapper {
    /// Whether `self` contains bits that are not in `other`
    ///
    /// The existing `is_superset` method also returns true for equal sets
    pub fn is_proper_superset(&self, other: &Self) -> bool {
        !self.is_subset(other)
    }

    pub fn into_inner(self) -> RoaringBitmap {
        self.0
    }
}
unsafe impl NonLocalValue for RoaringBitmapWrapper {}

// RoaringBitmap doesn't impl Eq: https://github.com/RoaringBitmap/roaring-rs/issues/302
// PartialEq can only return true if both bitmaps have the same internal representation, but two
// bitmaps with the same content should always have the same internal representation
impl Eq for RoaringBitmapWrapper {}

impl Deref for RoaringBitmapWrapper {
    type Target = RoaringBitmap;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}
impl DerefMut for RoaringBitmapWrapper {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}
impl Hash for RoaringBitmapWrapper {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        struct HasherWriter<'a, H: std::hash::Hasher>(&'a mut H);
        impl<H: std::hash::Hasher> std::io::Write for HasherWriter<'_, H> {
            fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
                self.0.write(buf);
                Ok(buf.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        self.0.serialize_into(HasherWriter(state)).unwrap();
    }
}

#[turbo_tasks::value(transparent, cell = "keyed")]
pub struct ModuleToChunkGroups(FxHashMap<ResolvedVc<Box<dyn Module>>, RoaringBitmapWrapper>);

#[turbo_tasks::value]
pub struct ChunkGroupInfo {
    pub module_chunk_groups: ResolvedVc<ModuleToChunkGroups>,
    #[bincode(with = "turbo_bincode::indexset")]
    pub chunk_groups: FxIndexSet<ChunkGroup>,
    #[turbo_tasks(unsafe_ignore)]
    #[bincode(with = "turbo_bincode::indexset")]
    pub chunk_group_keys: FxIndexSet<ChunkGroupKey>,
    pub chunking_heuristics: ChunkingHeuristicsInfo,
}

/// Chunking heuristics computed by [`compute_chunk_group_info`]. `clusters` is indexed by
/// chunk-group index (same length and order as [`ChunkGroupInfo::chunk_groups`]); `priority_routes`
/// is a set of those indices.
#[derive(Debug, Default, Clone, PartialEq, Eq, ValueDebugFormat, NonLocalValue, Encode, Decode)]
pub struct ChunkingHeuristicsInfo {
    /// For each chunk group (by index), the set of cluster IDs it belongs to. A cluster ID is the
    /// index of a configured cluster. A route's chunk group carries that route's clusters; chunk
    /// groups it pulls in inherit them.
    ///
    /// Example: `clusters[5] = [0, 2]` — chunk group 5 is part of clusters 0 and 2.
    pub clusters: Vec<Vec<u16>>,
    /// The set of chunk-group indices that belong to a priority route: the priority
    /// routes themselves, plus every chunk group they pull in.
    ///
    /// Example: `priority_routes = {3, 7}` — chunk groups 3 and 7 are served by a priority
    /// route; any group not in the set (e.g. 4) is not.
    pub priority_routes: RoaringBitmapWrapper,
}

#[turbo_tasks::value_impl]
impl ChunkGroupInfo {
    #[turbo_tasks::function]
    pub fn module_chunk_groups(&self) -> Vc<ModuleToChunkGroups> {
        *self.module_chunk_groups
    }

    #[turbo_tasks::function]
    pub async fn get_index_of(&self, chunk_group: ChunkGroup) -> Result<Vc<usize>> {
        if let Some(idx) = self.chunk_groups.get_index_of(&chunk_group) {
            Ok(Vc::cell(idx))
        } else {
            if cfg!(debug_assertions) {
                bail!(
                    "Couldn't find chunk group index for {} in {}",
                    chunk_group.debug_str(self).await?,
                    self.chunk_groups
                        .iter()
                        .map(|c| c.debug_str(self))
                        .try_join()
                        .await?
                        .join(", ")
                );
            } else {
                bail!("Couldn't find chunk group index")
            }
        }
    }
}

/// Per-entry chunking heuristics.
#[turbo_tasks::task_input]
#[derive(Debug, Default, Clone, Hash, PartialEq, Eq, Encode, Decode)]
pub struct EntryHeuristics {
    /// Cluster indices this route belongs to.
    pub clusters: Vec<u16>,
    pub high_priority: bool,
}

impl EntryHeuristics {
    /// Heuristics for an entry that is a high-priority route: belongs to no clusters and is marked
    /// as high priority.
    pub fn high_priority() -> Self {
        Self {
            clusters: Vec::new(),
            high_priority: true,
        }
    }
}

/// See [ChunkGroup] for documentation
#[turbo_tasks::task_input]
#[derive(Debug, Clone, Hash, PartialEq, Eq, Encode, Decode)]
pub enum ChunkGroupEntry {
    Entry {
        modules: Vec<ResolvedVc<Box<dyn Module>>>,
        heuristics: EntryHeuristics,
    },
    Async(ResolvedVc<Box<dyn Module>>),
    Isolated(ResolvedVc<Box<dyn Module>>),
    IsolatedMerged {
        parent: Box<ChunkGroupEntry>,
        merge_tag: RcStr,
        entries: Vec<ResolvedVc<Box<dyn Module>>>,
    },
    Shared(ResolvedVc<Box<dyn Module>>),
    SharedMultiple(Vec<ResolvedVc<Box<dyn Module>>>),
    SharedMerged {
        parent: Box<ChunkGroupEntry>,
        merge_tag: RcStr,
        entries: Vec<ResolvedVc<Box<dyn Module>>>,
    },
}
impl ChunkGroupEntry {
    pub fn entries(&self) -> impl Iterator<Item = ResolvedVc<Box<dyn Module>>> + '_ {
        match self {
            Self::Async(e) | Self::Isolated(e) | Self::Shared(e) => {
                Either::Left(std::iter::once(*e))
            }
            Self::Entry {
                modules: entries, ..
            }
            | Self::IsolatedMerged { entries, .. }
            | Self::SharedMultiple(entries)
            | Self::SharedMerged { entries, .. } => Either::Right(entries.iter().copied()),
        }
    }
}

#[turbo_tasks::task_input]
#[derive(Debug, Clone, Hash, PartialEq, Eq, Encode, Decode)]
pub enum ChunkGroup {
    /// The entry chunk group of the compilation, e.g. src/index.js for a SPA, or app/foo/page.js
    /// for Next.js.
    Entry(Vec<ResolvedVc<Box<dyn Module>>>),
    /// An async chunk group. Corresponds to an incoming [ChunkingType::Async] reference
    Async(ResolvedVc<Box<dyn Module>>),
    /// An isolated chunk group. Corresponds to an incoming [ChunkingType::Isolated] reference with
    /// `merge_tag: None`
    Isolated(ResolvedVc<Box<dyn Module>>),
    /// An isolated chunk group. Corresponds to an incoming [ChunkingType::Isolated] reference with
    /// `merge_tag: Some(_)`
    IsolatedMerged {
        parent: usize,
        merge_tag: RcStr,
        entries: Vec<ResolvedVc<Box<dyn Module>>>,
    },
    /// A shared chunk group. Corresponds to an incoming [ChunkingType::Shared] reference with
    /// `merge_tag: None`
    Shared(ResolvedVc<Box<dyn Module>>),
    /// A shared chunk group with multiple entries.
    SharedMultiple(Vec<ResolvedVc<Box<dyn Module>>>),
    /// A shared chunk group. Corresponds to an incoming [ChunkingType::Shared] reference with
    /// `merge_tag: Some(_)`
    SharedMerged {
        parent: usize,
        merge_tag: RcStr,
        entries: Vec<ResolvedVc<Box<dyn Module>>>,
    },
    /// a module with an incoming collected edge
    Collected(ResolvedVc<Box<dyn Module>>),
}

impl ChunkGroup {
    /// Returns the parent group when this chunk group is a merged group. In that case `entries()`
    /// are in unspecified order.
    pub fn get_merged_parent(&self) -> Option<usize> {
        match self {
            ChunkGroup::IsolatedMerged { parent, .. } | ChunkGroup::SharedMerged { parent, .. } => {
                Some(*parent)
            }
            _ => None,
        }
    }

    /// Iterates over the entries of the chunk group. When `get_merged_parent` is Some, the order is
    /// unspecified.
    pub fn entries(&self) -> impl Iterator<Item = ResolvedVc<Box<dyn Module>>> + Clone + '_ {
        match self {
            ChunkGroup::Async(e)
            | ChunkGroup::Isolated(e)
            | ChunkGroup::Shared(e)
            | ChunkGroup::Collected(e) => Either::Left(std::iter::once(*e)),
            ChunkGroup::Entry(entries)
            | ChunkGroup::IsolatedMerged { entries, .. }
            | ChunkGroup::SharedMultiple(entries)
            | ChunkGroup::SharedMerged { entries, .. } => Either::Right(entries.iter().copied()),
        }
    }

    pub fn entries_count(&self) -> usize {
        match self {
            ChunkGroup::Async(_)
            | ChunkGroup::Isolated(_)
            | ChunkGroup::Shared(_)
            | ChunkGroup::Collected(_) => 1,
            ChunkGroup::Entry(entries)
            | ChunkGroup::IsolatedMerged { entries, .. }
            | ChunkGroup::SharedMultiple(entries)
            | ChunkGroup::SharedMerged { entries, .. } => entries.len(),
        }
    }

    pub async fn debug_str(&self, chunk_group_info: &ChunkGroupInfo) -> Result<String> {
        Ok(match self {
            ChunkGroup::Entry(entries) => format!(
                "ChunkGroup::Entry({:?})",
                entries
                    .iter()
                    .map(|m| m.ident().to_string())
                    .try_join()
                    .await?
            ),
            ChunkGroup::Async(entry) => turbofmt!("ChunkGroup::Async({:?})", entry.ident())
                .await?
                .to_string(),
            ChunkGroup::Collected(entry) => turbofmt!("ChunkGroup::Collected({:?})", entry.ident())
                .await?
                .to_string(),
            ChunkGroup::Isolated(entry) => turbofmt!("ChunkGroup::Isolated({:?})", entry.ident())
                .await?
                .to_string(),
            ChunkGroup::Shared(entry) => turbofmt!("ChunkGroup::Shared({:?})", entry.ident())
                .await?
                .to_string(),
            ChunkGroup::SharedMultiple(entries) => format!(
                "ChunkGroup::SharedMultiple({:?})",
                entries
                    .iter()
                    .map(|m| m.ident().to_string())
                    .try_join()
                    .await?
            ),
            ChunkGroup::IsolatedMerged {
                parent,
                merge_tag,
                entries,
            } => {
                format!(
                    "ChunkGroup::IsolatedMerged({}, {}, {:?})",
                    Box::pin(chunk_group_info.chunk_groups[*parent].debug_str(chunk_group_info))
                        .await?,
                    merge_tag,
                    entries
                        .iter()
                        .map(|m| m.ident().to_string())
                        .try_join()
                        .await?
                )
            }
            ChunkGroup::SharedMerged {
                parent,
                merge_tag,
                entries,
            } => {
                format!(
                    "ChunkGroup::SharedMerged({}, {}, {:?})",
                    Box::pin(chunk_group_info.chunk_groups[*parent].debug_str(chunk_group_info))
                        .await?,
                    merge_tag,
                    entries
                        .iter()
                        .map(|m| m.ident().to_string())
                        .try_join()
                        .await?
                )
            }
        })
    }
}

/// See [ChunkGroup] for documentation
#[derive(Debug, Clone, Hash, PartialEq, Eq, Encode, Decode)]
pub enum ChunkGroupKey {
    Entry(Vec<ResolvedVc<Box<dyn Module>>>),
    Async(ResolvedVc<Box<dyn Module>>),
    Isolated(ResolvedVc<Box<dyn Module>>),
    IsolatedMerged {
        parent: ChunkGroupId,
        merge_tag: RcStr,
    },
    Shared(ResolvedVc<Box<dyn Module>>),
    SharedMultiple(Vec<ResolvedVc<Box<dyn Module>>>),
    SharedMerged {
        parent: ChunkGroupId,
        merge_tag: RcStr,
    },
    /// a module with an incoming collected edge
    Collected(ResolvedVc<Box<dyn Module>>),
}

impl ChunkGroupKey {
    pub async fn debug_str(
        &self,
        keys: impl std::ops::Index<usize, Output = Self>,
    ) -> Result<String> {
        Ok(match self {
            ChunkGroupKey::Entry(entries) => format!(
                "Entry({:?})",
                entries
                    .iter()
                    .map(|m| m.ident().to_string())
                    .try_join()
                    .await?
            ),
            ChunkGroupKey::Async(module) => {
                turbofmt!("Async({:?})", module.ident()).await?.to_string()
            }
            ChunkGroupKey::Collected(module) => turbofmt!("Collected({:?})", module.ident())
                .await?
                .to_string(),
            ChunkGroupKey::Isolated(module) => turbofmt!("Isolated({:?})", module.ident())
                .await?
                .to_string(),
            ChunkGroupKey::IsolatedMerged { parent, merge_tag } => {
                format!(
                    "IsolatedMerged {{ parent: {}, merge_tag: {:?} }}",
                    Box::pin(keys.index(parent.0 as usize).clone().debug_str(keys)).await?,
                    merge_tag
                )
            }
            ChunkGroupKey::Shared(module) => {
                turbofmt!("Shared({:?})", module.ident()).await?.to_string()
            }
            ChunkGroupKey::SharedMultiple(entries) => format!(
                "SharedMultiple({:?})",
                entries
                    .iter()
                    .map(|m| m.ident().to_string())
                    .try_join()
                    .await?
            ),
            ChunkGroupKey::SharedMerged { parent, merge_tag } => {
                format!(
                    "SharedMerged {{ parent: {}, merge_tag: {:?} }}",
                    Box::pin(keys.index(parent.0 as usize).clone().debug_str(keys)).await?,
                    merge_tag
                )
            }
        })
    }
}

#[derive(Debug, Copy, Clone, PartialEq, Eq, Hash, Encode, Decode)]
pub struct ChunkGroupId(u32);

impl From<usize> for ChunkGroupId {
    fn from(id: usize) -> Self {
        Self(id as u32)
    }
}

impl Deref for ChunkGroupId {
    type Target = u32;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TraversalPriority {
    pub depth: usize,
    pub chunk_group_len: u64,
}
impl PartialOrd for TraversalPriority {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}
// TODO automatically derive this using Reverse<_>
impl Ord for TraversalPriority {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        // BinaryHeap prioritizes high values

        // Smaller depth has higher priority
        let depth_order = self.depth.cmp(&other.depth).reverse();
        // Smaller group length has higher priority
        let chunk_group_len_order = self.chunk_group_len.cmp(&other.chunk_group_len).reverse();

        depth_order.then(chunk_group_len_order)
    }
}

/// The chunk groups of each module while [`compute_chunk_group_info`] propagates them, with every
/// distinct set of chunk groups stored once and referred to by an id.
///
/// The propagation checks whether a module's chunk groups add anything to those of the module it
/// references, and merges them if so, once per visited edge: on a large app hundreds of thousands
/// of times, but over few distinct pairs of sets, because most modules have the same chunk groups
/// as many others. Comparing two bitmaps costs time proportional to their size, so each distinct
/// pair is compared (and merged) once and the result is remembered by the pair's ids.
struct ModuleChunkGroupSets {
    /// The id (an index into `sets`) of each module's chunk groups.
    modules: FxHashMap<ResolvedVc<Box<dyn Module>>, u32>,
    sets: FxIndexSet<RoaringBitmapWrapper>,
    /// `(from, into)` -> the id of the union if it adds chunk groups to `into`, `None` otherwise.
    merges: FxHashMap<(u32, u32), Option<u32>>,
}

impl ModuleChunkGroupSets {
    fn new(module_count: usize) -> Self {
        let mut this = Self {
            modules: FxHashMap::with_capacity_and_hasher(module_count, Default::default()),
            sets: FxIndexSet::default(),
            merges: FxHashMap::default(),
        };
        this.intern(RoaringBitmapWrapper::default());
        this
    }

    fn intern(&mut self, set: RoaringBitmapWrapper) -> u32 {
        self.sets.insert_full(set).0 as u32
    }

    fn set(&self, id: u32) -> &RoaringBitmapWrapper {
        &self.sets[id as usize]
    }

    fn id_of(&self, module: &ResolvedVc<Box<dyn Module>>) -> Result<u32> {
        self.modules
            .get(module)
            .copied()
            .context("Module chunk group not found")
    }

    fn of(&self, module: &ResolvedVc<Box<dyn Module>>) -> Result<&RoaringBitmapWrapper> {
        Ok(self.set(self.id_of(module)?))
    }

    /// The id of the union of the sets `from` and `into` if `from` has chunk groups that `into`
    /// does not, `None` otherwise.
    fn merge(&mut self, from: u32, into: u32) -> Option<u32> {
        if from == into {
            return None;
        }
        if let Some(&merged) = self.merges.get(&(from, into)) {
            return merged;
        }
        let (from_set, into_set) = (self.set(from), self.set(into));
        let merged = if from_set.is_proper_superset(into_set) {
            let union = RoaringBitmapWrapper(&**from_set | &**into_set);
            Some(self.intern(union))
        } else {
            None
        };
        self.merges.insert((from, into), merged);
        merged
    }
}

pub async fn compute_chunk_group_info(graph: &ModuleGraph) -> Result<Vc<ChunkGroupInfo>> {
    let span_outer = tracing::info_span!(
        "compute chunk group info",
        module_count = tracing::field::Empty,
        visit_count = tracing::field::Empty,
        chunk_group_count = tracing::field::Empty
    );

    let span = span_outer.clone();
    async move {
        let mut chunk_groups_map: FxIndexMap<
            ChunkGroupKey,
            FxIndexSet<ResolvedVc<Box<dyn Module>>>,
        > = FxIndexMap::default();

        let module_count = graph
            .graphs
            .iter()
            .map(|g| g.graph.node_count())
            .sum::<usize>();
        span.record("module_count", module_count);

        // For each module, the indices in the bitmap store which chunk groups in `chunk_groups_map`
        // that module is part of.
        let mut module_chunk_groups = ModuleChunkGroupSets::new(module_count);

        // use all entries from all graphs
        let entries = graph.all_chunk_group_entries().collect::<Vec<_>>();

        // First, compute the depth for each module in the graph and initialize
        // `module_chunk_groups` with empty bitmaps.
        let module_depth: FxHashMap<ResolvedVc<Box<dyn Module>>, usize> = {
            let mut module_depth =
                FxHashMap::with_capacity_and_hasher(module_count, Default::default());
            graph.traverse_edges_bfs(
                entries.iter().flat_map(|e| e.entries()),
                |parent, node| {
                    if let Some((parent, _)) = parent {
                        let parent_depth = *module_depth
                            .get(&parent)
                            .context("Module depth not found")?;
                        module_depth.entry(node).or_insert(parent_depth + 1);
                    } else {
                        module_depth.insert(node, 0);
                    };

                    // the empty set
                    module_chunk_groups.modules.insert(node, 0);

                    Ok(GraphTraversalAction::Continue)
                },
            )?;
            module_depth
        };

        // ----

        fn entry_to_chunk_group_id(
            entry: ChunkGroupEntry,
            chunk_groups_map: &mut FxIndexMap<
                ChunkGroupKey,
                FxIndexSet<ResolvedVc<Box<dyn Module>>>,
            >,
        ) -> ChunkGroupKey {
            match entry {
                ChunkGroupEntry::Entry { modules, .. } => ChunkGroupKey::Entry(modules),
                ChunkGroupEntry::Async(entry) => ChunkGroupKey::Async(entry),
                ChunkGroupEntry::Isolated(entry) => ChunkGroupKey::Isolated(entry),
                ChunkGroupEntry::Shared(entry) => ChunkGroupKey::Shared(entry),
                ChunkGroupEntry::SharedMultiple(entries) => ChunkGroupKey::SharedMultiple(entries),
                ChunkGroupEntry::IsolatedMerged {
                    parent,
                    merge_tag,
                    entries: _,
                } => {
                    let parent = entry_to_chunk_group_id(*parent, chunk_groups_map);
                    let parent_entry = chunk_groups_map.entry(parent);
                    let parent_id = parent_entry.index();
                    parent_entry.or_default();

                    ChunkGroupKey::IsolatedMerged {
                        parent: ChunkGroupId::from(parent_id),
                        merge_tag,
                    }
                }
                ChunkGroupEntry::SharedMerged {
                    parent,
                    merge_tag,
                    entries: _,
                } => {
                    let parent = entry_to_chunk_group_id(*parent, chunk_groups_map);
                    let parent_entry = chunk_groups_map.entry(parent);
                    let parent_id = parent_entry.index();
                    parent_entry.or_default();

                    ChunkGroupKey::SharedMerged {
                        parent: ChunkGroupId::from(parent_id),
                        merge_tag,
                    }
                }
            }
        }

        let entry_chunk_group_keys = entries
            .iter()
            .flat_map(|&chunk_group| {
                let chunk_group_key =
                    entry_to_chunk_group_id(chunk_group.clone(), &mut chunk_groups_map);
                chunk_group
                    .entries()
                    .map(move |e| (e, chunk_group_key.clone()))
            })
            .collect::<FxHashMap<_, _>>();

        // `inherits_from[source]` is the set of chunk groups that inherit heuristics from `source`.
        let mut inherits_from: FxHashMap<u32, RoaringBitmap> = FxHashMap::default();

        let visit_count = graph.traverse_edges_fixed_point_with_priority(
            entries
                .iter()
                .flat_map(|e| e.entries())
                .map(|e| {
                    Ok((
                        e,
                        TraversalPriority {
                            depth: *module_depth.get(&e).context("Module depth not found")?,
                            chunk_group_len: 0,
                        },
                    ))
                })
                .collect::<Result<Vec<_>>>()?,
            &mut module_chunk_groups,
            |parent_info: Option<(ResolvedVc<Box<dyn Module>>, &'_ RefData, _)>,
             node: ResolvedVc<Box<dyn Module>>,
             _,
             module_chunk_groups: &mut ModuleChunkGroupSets|
             -> Result<GraphTraversalAction> {
                enum ChunkGroupInheritance<It: Iterator<Item = ChunkGroupKey>> {
                    Inherit(ResolvedVc<Box<dyn Module>>),
                    ChunkGroup(It),
                }
                let chunk_groups = if let Some((parent, ref_data, _)) = parent_info {
                    match &ref_data.chunking_type {
                        ChunkingType::Parallel { .. } => ChunkGroupInheritance::Inherit(parent),
                        ChunkingType::Async => ChunkGroupInheritance::ChunkGroup(Either::Left(
                            std::iter::once(ChunkGroupKey::Async(node)),
                        )),
                        ChunkingType::Isolated {
                            merge_tag: None, ..
                        } => ChunkGroupInheritance::ChunkGroup(Either::Left(std::iter::once(
                            ChunkGroupKey::Isolated(node),
                        ))),
                        ChunkingType::Shared {
                            merge_tag: None, ..
                        } => ChunkGroupInheritance::ChunkGroup(Either::Left(std::iter::once(
                            ChunkGroupKey::Shared(node),
                        ))),
                        ChunkingType::Isolated {
                            merge_tag: Some(merge_tag),
                            ..
                        } => {
                            let parents = module_chunk_groups.of(&parent)?;
                            let chunk_groups =
                                parents.iter().map(|parent| ChunkGroupKey::IsolatedMerged {
                                    parent: ChunkGroupId(parent),
                                    merge_tag: merge_tag.clone(),
                                });
                            ChunkGroupInheritance::ChunkGroup(Either::Right(Either::Left(
                                chunk_groups,
                            )))
                        }
                        ChunkingType::Shared {
                            merge_tag: Some(merge_tag),
                            ..
                        } => {
                            let parents = module_chunk_groups.of(&parent)?;
                            let chunk_groups =
                                parents.iter().map(|parent| ChunkGroupKey::SharedMerged {
                                    parent: ChunkGroupId(parent),
                                    merge_tag: merge_tag.clone(),
                                });
                            ChunkGroupInheritance::ChunkGroup(Either::Right(Either::Right(
                                chunk_groups,
                            )))
                        }
                        ChunkingType::Traced { .. } => {
                            // Traced modules are not placed in chunk groups
                            return Ok(GraphTraversalAction::Skip);
                        }
                        ChunkingType::Emitted {
                            namespace: _,
                            emit_to_all_entries: _,
                        } => {
                            // TODO ideally this would get the chunk group bitset of the parent
                            // ChunkGroup::Entry
                            ChunkGroupInheritance::ChunkGroup(Either::Left(std::iter::once(
                                ChunkGroupKey::Collected(node),
                            )))
                        }
                        ChunkingType::Collected { .. } => {
                            // These only exist in the module_batches graph.
                            unreachable!();
                        }
                        ChunkingType::PerEntry => {
                            // A collecting module belongs wherever its importer belongs. The
                            // per-entry behavior is carried by the `chunk_group` argument of
                            // `CollectingModule::as_chunk_item`, not by chunk group membership.
                            // This matches `collect.rs`, which inherits the parent's entry
                            // membership across this edge.
                            ChunkGroupInheritance::Inherit(parent)
                        }
                    }
                } else {
                    ChunkGroupInheritance::ChunkGroup(Either::Left(std::iter::once(
                        // TODO remove clone
                        entry_chunk_group_keys
                            .get(&node)
                            .context("Module chunk group not found")?
                            .clone(),
                    )))
                };

                Ok(match chunk_groups {
                    ChunkGroupInheritance::ChunkGroup(chunk_groups) => {
                        // Start of a new chunk group, don't inherit anything from parent
                        let chunk_group_ids = chunk_groups.map(|chunk_group| {
                            // For merged groups, the parent group id whose heuristics they inherit.
                            let merged_parent = match &chunk_group {
                                ChunkGroupKey::IsolatedMerged { parent, .. }
                                | ChunkGroupKey::SharedMerged { parent, .. } => Some(parent.0),
                                _ => None,
                            };
                            let id = match chunk_groups_map.entry(chunk_group) {
                                Entry::Occupied(mut e) => {
                                    let id = e.index() as u32;
                                    if merged_parent.is_some() {
                                        e.get_mut().insert(node);
                                    }
                                    id
                                }
                                Entry::Vacant(e) => {
                                    let id = e.index() as u32;
                                    let mut set = FxIndexSet::default();
                                    if merged_parent.is_some() {
                                        set.insert(node);
                                    }
                                    e.insert(set);
                                    id
                                }
                            };
                            // Record heuristics-inheritance edges into this chunk group: merged
                            // groups inherit from their specific parent group; all other groups
                            // inherit from every chunk group of the referencing module.
                            if let Some(parent) = merged_parent {
                                inherits_from.entry(parent).or_default().insert(id);
                            } else if let Some((parent_module, _, _)) = parent_info
                                && let Ok(parent_groups) = module_chunk_groups.of(&parent_module)
                            {
                                for source in parent_groups.iter() {
                                    inherits_from.entry(source).or_default().insert(id);
                                }
                            }
                            id
                        });

                        let chunk_groups =
                            RoaringBitmapWrapper(RoaringBitmap::from_iter(chunk_group_ids));

                        // Assign chunk group to the target node (the entry of the chunk group)
                        let bitset = module_chunk_groups.of(&node)?;
                        if chunk_groups.is_proper_superset(bitset) {
                            // Add bits from parent, and continue traversal because changed
                            let union = RoaringBitmapWrapper(&**bitset | chunk_groups.into_inner());
                            let union = module_chunk_groups.intern(union);
                            module_chunk_groups.modules.insert(node, union);

                            GraphTraversalAction::Continue
                        } else {
                            // Unchanged, no need to forward to children
                            GraphTraversalAction::Skip
                        }
                    }
                    ChunkGroupInheritance::Inherit(parent) => {
                        // Inherit chunk groups from parent, merge parent chunk groups into
                        // current

                        if parent == node {
                            // A self-reference
                            GraphTraversalAction::Skip
                        } else {
                            let (Ok(parent_chunk_groups), Ok(current_chunk_groups)) = (
                                module_chunk_groups.id_of(&parent),
                                module_chunk_groups.id_of(&node),
                            ) else {
                                // All modules are inserted in the previous iteration
                                // Technically unreachable, but could be reached due to eventual
                                // consistency
                                bail!("Module chunk groups not found");
                            };

                            if module_chunk_groups.set(current_chunk_groups).is_empty() {
                                // Initial visit, take the parent's instead of merging
                                module_chunk_groups
                                    .modules
                                    .insert(node, parent_chunk_groups);
                                GraphTraversalAction::Continue
                            } else if let Some(union) =
                                module_chunk_groups.merge(parent_chunk_groups, current_chunk_groups)
                            {
                                // Add bits from parent, and continue traversal because changed
                                module_chunk_groups.modules.insert(node, union);
                                GraphTraversalAction::Continue
                            } else {
                                // Unchanged, no need to forward to children
                                GraphTraversalAction::Skip
                            }
                        }
                    }
                })
            },
            // This priority is used as a heuristic to keep the number of retraversals down, by
            // - keeping it similar to a BFS via the depth priority
            // - prioritizing smaller chunk groups which are expected to themselves reference
            //   bigger chunk groups (i.e. shared code deeper down in the graph).
            //
            // Both try to first visit modules with a large dependency subgraph first (which
            // would be higher in the graph and are included by few chunks themselves).
            |successor, module_chunk_groups| {
                Ok(TraversalPriority {
                    depth: *module_depth
                        .get(&successor)
                        .context("Module depth not found")?,
                    chunk_group_len: module_chunk_groups.of(&successor)?.len(),
                })
            },
        )?;

        span.record("visit_count", visit_count);
        span.record("chunk_group_count", chunk_groups_map.len());

        let ModuleChunkGroupSets { modules, sets, .. } = module_chunk_groups;
        let module_chunk_groups: FxHashMap<ResolvedVc<Box<dyn Module>>, RoaringBitmapWrapper> =
            modules
                .into_iter()
                .map(|(module, id)| (module, sets[id as usize].clone()))
                .collect();
        drop(sets);

        static PRINT_CHUNK_GROUP_INFO: LazyLock<bool> =
            LazyLock::new(|| match std::env::var_os("TURBOPACK_PRINT_CHUNK_GROUPS") {
                Some(v) => v == "1",
                None => false,
            });
        if *PRINT_CHUNK_GROUP_INFO {
            use std::{
                collections::{BTreeMap, BTreeSet},
                path::absolute,
            };

            let mut buckets = BTreeMap::default();
            for (module, key) in &module_chunk_groups {
                if !key.is_empty() {
                    buckets
                        .entry(key.iter().collect::<Vec<_>>())
                        .or_insert(BTreeSet::new())
                        .insert(module.ident().to_string().await?);
                }
            }

            let mut result = vec![];
            result.push("Chunk Groups:".to_string());
            for (i, (key, _)) in chunk_groups_map.iter().enumerate() {
                result.push(format!(
                    "  {:?}: {}",
                    i,
                    key.debug_str(chunk_groups_map.keys()).await?
                ));
            }
            result.push("# Module buckets:".to_string());
            for (key, modules) in buckets.iter() {
                result.push(format!("## {:?}:", key.iter().collect::<Vec<_>>()));
                for module in modules {
                    result.push(format!("  {module}"));
                }
                result.push("".to_string());
            }
            let f = absolute(format!("chunk_group_info_{}.log", visit_count))?;
            println!("Wrote Chunk Group Info to {}", f.display());
            std::fs::write(f, result.join("\n"))?;
        }

        // Resolve per-chunk-group chunking heuristics. Entry
        // chunk groups carry their route's clusters / priority-route flag; other chunk groups
        // inherit the union of clusters (and OR of the flag) from their referencing chunk groups.
        let mut clusters: Vec<RoaringBitmap> = vec![RoaringBitmap::new(); chunk_groups_map.len()];
        let mut priority_routes = RoaringBitmap::new();

        let mut worklist: Vec<usize> = Vec::new();

        for chunk_group in &entries {
            let ChunkGroupEntry::Entry {
                modules,
                heuristics,
            } = chunk_group
            else {
                continue;
            };
            if heuristics.clusters.is_empty() && !heuristics.high_priority {
                continue;
            }
            if let Some(index) =
                chunk_groups_map.get_index_of(&ChunkGroupKey::Entry(modules.clone()))
            {
                if clusters[index].is_empty() && !priority_routes.contains(index as u32) {
                    worklist.push(index);
                }
                clusters[index].extend(heuristics.clusters.iter().map(|&c| c as u32));
                if heuristics.high_priority {
                    priority_routes.insert(index as u32);
                }
            }
        }

        while let Some(source) = worklist.pop() {
            let source_priority_route = priority_routes.contains(source as u32);
            let Some(targets) = inherits_from.get(&(source as u32)) else {
                continue;
            };
            for target in targets.iter() {
                let target = target as usize;
                if target == source {
                    continue;
                }
                let [source_clusters, target_clusters] =
                    clusters.get_disjoint_mut([source, target]).unwrap();
                let previous_target_clusters_len = target_clusters.len();
                *target_clusters |= &*source_clusters;
                let changed = (source_priority_route && priority_routes.insert(target as u32))
                    || previous_target_clusters_len != target_clusters.len();
                if changed {
                    worklist.push(target);
                }
            }
        }

        let chunk_group_clusters: Vec<Vec<u16>> = clusters
            .into_iter()
            .map(|bm| bm.iter().map(|id| id as u16).collect())
            .collect();
        let chunk_group_priority_routes = RoaringBitmapWrapper(priority_routes);

        Ok(ChunkGroupInfo {
            module_chunk_groups: ResolvedVc::cell(module_chunk_groups),
            chunk_group_keys: chunk_groups_map.keys().cloned().collect(),
            chunking_heuristics: ChunkingHeuristicsInfo {
                clusters: chunk_group_clusters,
                priority_routes: chunk_group_priority_routes,
            },
            chunk_groups: chunk_groups_map
                .into_iter()
                .map(|(k, merged_entries)| match k {
                    ChunkGroupKey::Entry(entries) => ChunkGroup::Entry(entries),
                    ChunkGroupKey::Async(module) => ChunkGroup::Async(module),
                    ChunkGroupKey::Collected(module) => ChunkGroup::Collected(module),
                    ChunkGroupKey::Isolated(module) => ChunkGroup::Isolated(module),
                    ChunkGroupKey::IsolatedMerged { parent, merge_tag } => {
                        ChunkGroup::IsolatedMerged {
                            parent: parent.0 as usize,
                            merge_tag,
                            entries: merged_entries.into_iter().collect(),
                        }
                    }
                    ChunkGroupKey::Shared(module) => ChunkGroup::Shared(module),
                    ChunkGroupKey::SharedMultiple(entries) => ChunkGroup::SharedMultiple(entries),
                    ChunkGroupKey::SharedMerged { parent, merge_tag } => ChunkGroup::SharedMerged {
                        parent: parent.0 as usize,
                        merge_tag,
                        entries: merged_entries.into_iter().collect(),
                    },
                })
                .collect(),
        }
        .cell())
    }
    .instrument(span_outer)
    .await
}

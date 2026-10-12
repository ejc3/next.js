use std::cmp::min;

use smallvec::SmallVec;
use turbo_tasks::{TaskId, TraitTypeId};

use crate::{
    backend::{
        TaskDataCategory,
        operation::{
            AggregatedDataUpdate, AggregationUpdateJob, AggregationUpdateQueue, ExecuteContext,
        },
        storage_schema::TaskStorageAccessors,
    },
    data::CollectibleRef,
};

pub struct UpdateCollectibleOperation;

impl UpdateCollectibleOperation {
    pub fn run(task_id: TaskId, collectible: CollectibleRef, count: i32, ctx: ExecuteContext<'_>) {
        Self::run_many(task_id, [(collectible, count)], ctx);
    }

    /// Applies several collectible count changes of one task as one operation.
    ///
    /// Each change is applied to the task exactly as [`Self::run`] applies a single one. The
    /// changes then reach the task's uppers as one aggregated data update, so the aggregation
    /// graph above the task is walked once for the batch instead of once per collectible.
    pub fn run_many(
        task_id: TaskId,
        collectibles: impl IntoIterator<Item = (CollectibleRef, i32)>,
        mut ctx: ExecuteContext<'_>,
    ) {
        let collectibles: SmallVec<[(CollectibleRef, i32); 1]> = collectibles.into_iter().collect();
        if collectibles.is_empty() {
            return;
        }
        let mut task = ctx.task(task_id, TaskDataCategory::All);
        if collectibles.iter().any(|&(_, count)| count < 0)
            && task
                .get_persistent_task_type()
                .is_some_and(|t| !t.native_fn.is_root)
        {
            drop(task);
            panic!(
                "Removing collectibles from non-root task {} (emitting task: {}). The `root` \
                 attribute is missing on the task.",
                ctx.debug_get_task_description(task_id),
                ctx.debug_get_task_description(task_id)
            );
        }
        let mut queue = AggregationUpdateQueue::new();
        let mut update = Vec::with_capacity(collectibles.len());
        let mut crossed: SmallVec<[TraitTypeId; 1]> = SmallVec::new();
        for (collectible, mut count) in collectibles {
            let outdated = task.get_outdated_collectibles(&collectible).copied();
            if let Some(outdated) = outdated {
                if count > 0 && outdated > 0 {
                    let shared = min(count, outdated);
                    let _ =
                        task.update_outdated_collectibles_positive_crossing(collectible, -shared);
                    count -= shared;
                } else if count < 0 && outdated < 0 {
                    let shared = min(-count, -outdated);
                    let _ =
                        task.update_outdated_collectibles_positive_crossing(collectible, shared);
                    count += shared;
                } else {
                    // Not reduced from outdated
                }
            }
            if count != 0 {
                if task.update_collectibles_positive_crossing(collectible, count)
                    && !crossed.contains(&collectible.collectible_type)
                {
                    crossed.push(collectible.collectible_type);
                }
                update.push((collectible, count));
            }
        }
        // Dependents of a collectible type are invalidated once per batch, as
        // `cleanup_old_edges` does for a task's outdated collectibles.
        for ty in crossed {
            let dependent: SmallVec<[TaskId; 4]> = task
                .iter_collectibles_dependents()
                .filter_map(|(collectible_type, task)| (collectible_type == ty).then_some(task))
                .collect();
            if !dependent.is_empty() {
                queue.push(AggregationUpdateJob::InvalidateDueToCollectiblesChange {
                    task_ids: dependent,
                    collectibles_task: task_id,
                    collectible_type: ty,
                })
            }
        }
        if !update.is_empty() {
            queue.extend(AggregationUpdateJob::data_update(
                &mut task,
                AggregatedDataUpdate::new().collectibles_update(update),
            ));
        }

        drop(task);

        queue.execute(&mut ctx);
    }
}

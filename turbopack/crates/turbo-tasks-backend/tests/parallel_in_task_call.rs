#![feature(arbitrary_self_types)]
#![allow(clippy::needless_return)] // tokio macro-generated code doesn't respect this

use turbo_tasks::{parallel, with_turbo_tasks};
use turbo_tasks_testing::{Registration, register, run_once};

static REGISTRATION: Registration = register!();

/// The `parallel` helpers run part of their jobs on the calling thread. That must work while the
/// thread holds the turbo-tasks context borrowed, as it does inside `with_turbo_tasks`: task calls
/// run there, and so do the backend's restores of task data from the persistent cache.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn parallel_map_collect_inside_with_turbo_tasks() {
    run_once(&REGISTRATION, || async {
        let items: Vec<u32> = (0..1000).collect();
        let doubled: Vec<u32> = with_turbo_tasks(|_| parallel::map_collect(&items, |x| x * 2));
        assert_eq!(doubled, items.iter().map(|x| x * 2).collect::<Vec<_>>());
        anyhow::Ok(())
    })
    .await
    .unwrap()
}

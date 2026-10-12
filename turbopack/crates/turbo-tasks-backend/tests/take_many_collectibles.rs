#![feature(arbitrary_self_types)]
#![feature(arbitrary_self_types_pointers)]
#![allow(clippy::needless_return)] // clippy bug causes false positive

use anyhow::Result;
use turbo_rcstr::RcStr;
use turbo_tasks::{CollectiblesSource, ResolvedVc, State, ValueToString, Vc, emit};
use turbo_tasks_testing::{Registration, register, run_once};

static REGISTRATION: Registration = register!();

// A task that takes many collectibles at once removes them all from its own collectibles in one
// call. Re-running it with a different set must leave its count of each collectible right: the
// taker sees exactly the current set, and nothing it took is visible in a task above it.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn take_many_collectibles() {
    run_once(&REGISTRATION, async || {
        let input = ChangingInput {
            state: State::new(5),
        }
        .resolved_cell();
        let output = outer(input);
        for n in [5, 8, 3, 0, 6, 6, 1, 9] {
            input.await?.state.set(n);
            let read = output.read_strongly_consistent().await?;
            assert_eq!(
                (read.taken, read.taken_sum, read.above),
                (n, (0..n).sum(), 0),
                "after emitting {n}"
            );
        }
        anyhow::Ok(())
    })
    .await
    .unwrap()
}

#[turbo_tasks::value]
struct ChangingInput {
    state: State<u32>,
}

#[turbo_tasks::value]
struct Output {
    taken: u32,
    taken_sum: u32,
    above: u32,
}

#[turbo_tasks::value]
struct Collectible {
    value: u32,
}

#[turbo_tasks::value_impl]
impl ValueToString for Collectible {
    #[turbo_tasks::function]
    fn to_string(&self) -> Vc<RcStr> {
        Vc::cell(self.value.to_string().into())
    }
}

/// Emits `n` collectibles, the first of them twice, so one count is above 1.
#[turbo_tasks::function(operation, root)]
async fn emitter(input: ResolvedVc<ChangingInput>) -> Result<Vc<()>> {
    let n = *input.await?.state.get();
    for value in 0..n {
        let collectible: ResolvedVc<Box<dyn ValueToString>> =
            ResolvedVc::upcast(Collectible { value }.resolved_cell());
        emit(collectible);
        if value == 0 {
            emit(collectible);
        }
    }
    Ok(Vc::cell(()))
}

#[turbo_tasks::value(transparent)]
struct Taken((u32, u32));

#[turbo_tasks::function(operation, root)]
async fn taker(input: ResolvedVc<ChangingInput>) -> Result<Vc<Taken>> {
    let op = emitter(input);
    op.connect().await?;
    let mut sum = 0;
    let taken = op.take_collectibles::<Box<dyn ValueToString>>();
    for collectible in &taken {
        sum += collectible.to_string().await?.parse::<u32>()?;
    }
    Ok(Vc::cell((taken.len() as u32, sum)))
}

/// Passes the taker's result through, so the taker's collectibles reach it as an upper.
#[turbo_tasks::function(operation, root)]
async fn middle(input: ResolvedVc<ChangingInput>) -> Result<Vc<Taken>> {
    Ok(taker(input).connect())
}

#[turbo_tasks::function(operation, root)]
async fn outer(input: ResolvedVc<ChangingInput>) -> Result<Vc<Output>> {
    let op = middle(input);
    let (taken, taken_sum) = *op.connect().await?;
    let above = op.peek_collectibles::<Box<dyn ValueToString>>().len() as u32;
    Ok(Output {
        taken,
        taken_sum,
        above,
    }
    .cell())
}

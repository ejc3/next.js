#![feature(arbitrary_self_types)]
#![feature(arbitrary_self_types_pointers)]
#![allow(clippy::needless_return)] // clippy bug causes false positive

use anyhow::Result;
use turbo_rcstr::RcStr;
use turbo_tasks::{CollectiblesSource, ResolvedVc, State, ValueToString, Vc, emit};
use turbo_tasks_testing::{Registration, register, run_once};

static REGISTRATION: Registration = register!();

// A task that gets many new children in one execution, each emitting a collectible: every one
// of them must reach a task above it, and those of children it no longer calls must leave it.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn many_new_children_collectibles() {
    run_once(&REGISTRATION, async || {
        let input = ChangingInput {
            state: State::new((0, 0)),
        }
        .resolved_cell();
        let output = outer(input);
        for (offset, n) in [
            (0, 50),
            (50, 200),
            (100, 200),
            (0, 7),
            (1000, 300),
            (0, 0),
            (5, 64),
        ] {
            input.await?.state.set((offset, n));
            let read = output.read_strongly_consistent().await?;
            assert_eq!(
                (read.count, read.sum),
                (n, (offset..offset + n).sum()),
                "after children {offset}..{}",
                offset + n
            );
        }
        anyhow::Ok(())
    })
    .await
    .unwrap()
}

#[turbo_tasks::value]
struct ChangingInput {
    state: State<(u32, u32)>,
}

#[turbo_tasks::value]
struct Output {
    count: u32,
    sum: u32,
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

#[turbo_tasks::function]
fn child(value: u32) -> Vc<()> {
    let collectible: ResolvedVc<Box<dyn ValueToString>> =
        ResolvedVc::upcast(Collectible { value }.resolved_cell());
    emit(collectible);
    Vc::cell(())
}

/// Calls `child(offset..offset + n)`, so a change of `offset` replaces most of its children.
#[turbo_tasks::function(operation, root)]
async fn parent(input: ResolvedVc<ChangingInput>) -> Result<Vc<()>> {
    let (offset, n) = *input.await?.state.get();
    for value in offset..offset + n {
        child(value).await?;
    }
    Ok(Vc::cell(()))
}

/// Passes through the parent, so the children's collectibles reach it through the parent.
#[turbo_tasks::function(operation, root)]
async fn middle(input: ResolvedVc<ChangingInput>) -> Result<Vc<()>> {
    parent(input).connect().await?;
    Ok(Vc::cell(()))
}

#[turbo_tasks::function(operation, root)]
async fn outer(input: ResolvedVc<ChangingInput>) -> Result<Vc<Output>> {
    let op = middle(input);
    op.connect().await?;
    let collectibles = op.peek_collectibles::<Box<dyn ValueToString>>();
    let mut sum = 0;
    for collectible in &collectibles {
        sum += collectible.to_string().await?.parse::<u32>()?;
    }
    Ok(Output {
        count: collectibles.len() as u32,
        sum,
    }
    .cell())
}

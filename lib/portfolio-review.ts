import { getPortfolioSnapshot } from '@/lib/portfolio-control';
import { createTask, getTaskBoard } from '@/lib/task-router';

export async function runPortfolioReview(profileId: string) {
  const snapshot = await getPortfolioSnapshot(profileId);
  const board = await getTaskBoard(profileId);
  const open = [...board.queues.now, ...board.queues.decisions, ...board.queues.working, ...board.queues.delegated];
  let createdTasks = 0;

  for (const item of snapshot.goalHealth.filter((entry) => entry.health === 'critical' || entry.health === 'at_risk').slice(0, 5)) {
    const sessionId = `portfolio-goal-${item.goal.id}`;
    if (open.some((task) => task.sessionId === sessionId && task.status !== 'completed' && task.status !== 'cancelled')) continue;
    await createTask(profileId, {
      objective: `Recover portfolio goal: ${item.goal.title}. Health: ${item.health}. Evidence: ${item.reasons.join(' ')} Review linked tasks, dependencies, deadline and ownership. Prepare the smallest safe recovery plan. External communications or mutations remain approval-gated.`,
      queue: 'now',
      owner: 'ai',
      priority: item.health === 'critical' ? 'critical' : 'high',
      approval: 'none',
      source: 'portfolio-control',
      sessionId,
      summary: `Portfolio recovery: ${item.goal.title}`,
    });
    createdTasks += 1;
  }

  for (const item of snapshot.delegationExceptions.filter((entry) => entry.severity === 'critical' || entry.severity === 'high').slice(0, 5)) {
    const sessionId = `portfolio-delegation-${item.delegation.id}`;
    if (open.some((task) => task.sessionId === sessionId && task.status !== 'completed' && task.status !== 'cancelled')) continue;
    await createTask(profileId, {
      objective: `Delegation exception for ${item.delegation.delegatee}: ${item.delegation.expectedOutcome}. ${item.reason} Recommended: ${item.recommendedAction} Prepare recovery/escalation context but do not send an external message without approval.`,
      queue: 'now',
      owner: 'ai',
      priority: item.severity === 'critical' ? 'critical' : 'high',
      approval: 'none',
      source: 'portfolio-control',
      sessionId,
      summary: `Delegation exception: ${item.delegation.delegatee}`,
    });
    createdTasks += 1;
  }

  return { snapshot, createdTasks };
}

const SUMMARY_LABELS = Object.freeze({
  CONTEXT_READ: 'Контекст задачі прочитано.',
  WORK_STARTED: 'Роботу розпочато.',
  IMPLEMENTATION_ACTIVE: 'Зміни в межах задачі тривають.',
  CHECKPOINT_VERIFIED: 'Контрольну перевірку завершено.',
  FOCUSED_PROOF_RUNNING: 'Запущено цільову перевірку.',
  FOCUSED_PROOF_PASSED: 'Цільова перевірка пройшла.',
  REVIEW_READY: 'Пакет готовий до незалежного ревʼю.',
  SAFE_STOP: 'Безпечне продовження зупинено.',
});

const NEXT_ACTION_LABELS = Object.freeze({
  READ_PINNED_CONTEXT: 'Прочитати закріплений контекст.',
  RUN_PRECHANGE_PROOF: 'Запустити pre-change proof.',
  IMPLEMENT: 'Виконати зміну в межах lease.',
  RUN_FOCUSED_PROOF: 'Запустити цільову перевірку.',
  RUN_ADVERSARIAL_REVIEW: 'Запустити незалежне adversarial review.',
  PUBLISH_HANDOFF: 'Опублікувати handoff для ревʼю.',
  AWAIT_ORCHESTRATOR: 'Чекати рішення оркестратора.',
  NONE: 'Наступної дії немає.',
});

const BLOCKER_LABELS = Object.freeze({
  ASSIGNMENT_AMBIGUOUS: 'Призначення задачі неоднозначне.',
  CONTEXT_MISSING: 'У закріпленому контексті бракує необхідного матеріалу.',
  LEASE_EXPIRED: 'Lease задачі завершився.',
  DEPENDENCY_BLOCKED: 'Залежна задача або доказ не готові.',
  TEST_ENVIRONMENT_UNAVAILABLE: 'Середовище перевірки недоступне.',
  REQUIRES_EDWIN_DECISION: 'Потрібне рішення Edwin за stop condition.',
  REMOTE_UNAVAILABLE: 'Канонічний remote недоступний.',
  UNKNOWN_SAFE_STOP: 'Роботу зупинено безпечним чином.',
});

export function agentStatusLabels(status) {
  return {
    summary: SUMMARY_LABELS[status.summary_code] ?? 'Невідомий код підсумку.',
    next_action: NEXT_ACTION_LABELS[status.next_action_code] ?? 'Невідомий код наступної дії.',
    blocker: status.blocker_code === null
      ? null
      : (BLOCKER_LABELS[status.blocker_code] ?? 'Невідомий код блокування.'),
  };
}

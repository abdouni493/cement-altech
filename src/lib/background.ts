/**
 * RECHARGEMENTS EN ARRIERE-PLAN
 * ---------------------------------------------------------------------------
 * Apres un enregistrement, les AUTRES ecrans concernes (caisse, clients,
 * ventes, stock…) doivent etre relus. L'operateur n'a pas a attendre ces
 * lectures : elles partent en arriere-plan et la fenetre se ferme tout de
 * suite. Plusieurs demandes pour le meme ecran sont fusionnees : une lecture
 * en cours + au plus une relance a la fin, jamais dix lectures identiques.
 */
const running = new Map<string, Promise<void>>();
const pending = new Set<string>();

export function inBackground(key: string, load: () => Promise<unknown>): Promise<void> {
  if (running.has(key)) {
    pending.add(key);
    return Promise.resolve();
  }
  const run = (async () => {
    try { await load(); } catch { /* relu au prochain passage sur l'ecran */ }
  })().finally(() => {
    running.delete(key);
    if (pending.delete(key)) void inBackground(key, load);
  });
  running.set(key, run);
  return Promise.resolve();
}

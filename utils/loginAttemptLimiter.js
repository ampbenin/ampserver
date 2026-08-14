/**
 * Limiteur de tentatives de connexion PAR COMPTE — pas par IP.
 *
 * Remplace `config/rateLimit.js#authLimiter` (express-rate-limit, clé =
 * IP) sur les routes de LOGIN spécifiquement, suite à un bug signalé par
 * l'utilisateur : sur un réseau partagé (bureau, wifi commun à plusieurs
 * volontaires/partenaires), le blocage par IP touchait TOUS les
 * utilisateurs de ce réseau dès qu'UN SEUL compte enchaînait des échecs —
 * jamais le comportement voulu ("bloquer CE compte-là, pas les autres").
 *
 * En mémoire (Map), pas de persistance — un redémarrage du serveur
 * réinitialise tous les compteurs. Acceptable ici : c'est un frein au
 * brute-force sur un compte précis, pas une protection de sécurité
 * absolue (qui nécessiterait un store partagé type Redis si le backend
 * tournait en plusieurs instances — ce n'est pas le cas ici).
 *
 * `namespace` évite qu'un même email utilisé sur deux systèmes de compte
 * différents (ex. GestionAmpUser et Volunteer) ne partage un seul
 * compteur — chaque système de connexion appelle avec son propre
 * namespace ("gestionamp", "volunteer", "numsal").
 */

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 10;

const attempts = new Map(); // clé "namespace:email" -> { count, firstAttemptAt }

function buildKey(namespace, email) {
  return `${namespace}:${String(email || "").toLowerCase().trim()}`;
}

function isLocked(namespace, email) {
  const key = buildKey(namespace, email);
  const entry = attempts.get(key);
  if (!entry) return false;
  if (Date.now() - entry.firstAttemptAt > WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailedAttempt(namespace, email) {
  const key = buildKey(namespace, email);
  const entry = attempts.get(key);
  if (!entry || Date.now() - entry.firstAttemptAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAttemptAt: Date.now() });
  } else {
    entry.count += 1;
  }
}

function resetAttempts(namespace, email) {
  attempts.delete(buildKey(namespace, email));
}

// Purge légère et périodique — évite une fuite mémoire lente sur un
// serveur qui tourne longtemps. Négligeable en coût vu le volume attendu.
// unref() : ce timer ne doit jamais empêcher le process de s'arrêter proprement.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) {
    if (now - entry.firstAttemptAt > WINDOW_MS) attempts.delete(key);
  }
}, WINDOW_MS).unref();

module.exports = { isLocked, recordFailedAttempt, resetAttempts, MAX_ATTEMPTS, WINDOW_MS };

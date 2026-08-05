/**
 * Logique pure de suivi des tâches de mission (aucune dépendance DB — testable
 * isolément). Réutilisée par controllers/volunteerTaskController.js.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Tronque une date à minuit (UTC) — les échéances sont comparées jour par
// jour, jamais à l'heure/minute près.
const startOfDay = (date) => {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

/**
 * Liste des échéances dues pour une tâche donnée, depuis la date
 * d'acceptation du volontaire (`assignedAt`) jusqu'à aujourd'hui ou la fin
 * du programme (`programEndDate`), la première atteinte.
 * - ONCE  → une seule "échéance" représentée par `null`.
 * - DAILY → une échéance par jour.
 * - WEEKLY → une échéance par semaine (7 jours), à partir d'assignedAt.
 *
 * @param {{recurrence: "ONCE"|"DAILY"|"WEEKLY"}} task
 * @param {Date|string} assignedAt
 * @param {Date|string|null} programEndDate
 * @returns {Array<Date|null>}
 */
function getDueOccurrences(task, assignedAt, programEndDate) {
  if (task.recurrence === "ONCE") return [null];

  const start = startOfDay(assignedAt);
  const today = startOfDay(new Date());
  const cap = programEndDate ? startOfDay(programEndDate) : today;
  const end = cap < today ? cap : today;

  if (end < start) return [];

  const stepDays = task.recurrence === "WEEKLY" ? 7 : 1;
  const occurrences = [];
  for (let t = start.getTime(); t <= end.getTime(); t += stepDays * MS_PER_DAY) {
    occurrences.push(new Date(t));
  }
  return occurrences;
}

/**
 * Calcule la progression d'un volontaire sur un programme : nombre
 * d'occurrences dues (toutes tâches confondues), combien sont approuvées, et
 * le % correspondant.
 *
 * @param {Array} tasks - VolunteerProgram.tasks
 * @param {Date|string} assignedAt
 * @param {Date|string|null} programEndDate
 * @param {Array<{taskId: string, occurrenceDate: Date|null, status: string}>} submissions
 * @returns {{ totalDue: number, approved: number, percent: number }}
 */
function computeProgress(tasks, assignedAt, programEndDate, submissions) {
  const approvedKeys = new Set(
    submissions
      .filter((s) => s.status === "APPROVED")
      .map((s) => `${s.taskId}|${s.occurrenceDate ? startOfDay(s.occurrenceDate).getTime() : "once"}`)
  );

  let totalDue = 0;
  let approved = 0;

  for (const task of tasks) {
    const due = getDueOccurrences(task, assignedAt, programEndDate);
    for (const occurrenceDate of due) {
      totalDue += 1;
      const key = `${task.id}|${occurrenceDate ? occurrenceDate.getTime() : "once"}`;
      if (approvedKeys.has(key)) approved += 1;
    }
  }

  const percent = totalDue > 0 ? Math.round((approved / totalDue) * 100) : 0;
  return { totalDue, approved, percent };
}

module.exports = { getDueOccurrences, computeProgress, startOfDay };

/**
 * Contrôleur Inscriptions — Plateforme NumSAL
 * Inscription d'un apprenant à un cours, suivi de progression (leçons
 * cochées), vue formateur (progression des inscrits) et vue tuteur
 * (progression de ses apprenants assignés, tous cours confondus).
 */

const getNumsalCourseModel = require("../../models/numsal/NumsalCourse");
const getNumsalEnrollmentModel = require("../../models/numsal/NumsalEnrollment");
const getNumsalUserModel = require("../../models/numsal/NumsalUser");

const withProgress = (enrollment, course) => {
  const total = course?.lessons?.length || 0;
  const done = enrollment.completedLessonIds.length;
  return {
    id: enrollment._id,
    courseId: enrollment.courseId,
    learnerId: enrollment.learnerId,
    enrolledAt: enrollment.enrolledAt,
    lastActivityAt: enrollment.lastActivityAt,
    completedLessonIds: enrollment.completedLessonIds,
    totalLessons: total,
    progressPercent: total ? Math.round((done / total) * 100) : 0,
  };
};

/* -------------------- Apprenant : s'inscrire à un cours -------------------- */
exports.enroll = async (req, res, next) => {
  try {
    const Course = getNumsalCourseModel();
    const Enrollment = getNumsalEnrollmentModel();
    const { courseId } = req.body;

    if (!courseId) return res.status(400).json({ message: "courseId requis" });

    const course = await Course.findOne({ _id: courseId, status: "PUBLISHED" });
    if (!course) return res.status(404).json({ message: "Cours introuvable ou non publié" });

    if (course.accessMode !== "OPEN") {
      return res.status(400).json({
        message: "Ce programme nécessite une candidature — l'inscription directe n'est pas disponible",
      });
    }

    const enrollment = await Enrollment.create({ learnerId: req.user.id, courseId });
    res.status(201).json(withProgress(enrollment, course));
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "Vous êtes déjà inscrit à ce cours" });
    }
    next(error);
  }
};

/* -------------------- Apprenant : mes cours + progression -------------------- */
exports.myEnrollments = async (req, res, next) => {
  try {
    const Enrollment = getNumsalEnrollmentModel();
    const enrollments = await Enrollment.find({ learnerId: req.user.id })
      .populate("courseId", "title description coverImageUrl lessons")
      .sort({ lastActivityAt: -1 });

    const items = enrollments.map((e) => ({
      ...withProgress(e, e.courseId),
      course: e.courseId && {
        id: e.courseId._id,
        title: e.courseId.title,
        description: e.courseId.description,
        coverImageUrl: e.courseId.coverImageUrl,
      },
    }));

    res.json({ items });
  } catch (error) {
    next(error);
  }
};

const findOwnEnrollment = async (Enrollment, enrollmentId, learnerId) => {
  return Enrollment.findOne({ _id: enrollmentId, learnerId });
};

/* -------------------- Apprenant : cocher une leçon terminée -------------------- */
exports.markLessonComplete = async (req, res, next) => {
  try {
    const Enrollment = getNumsalEnrollmentModel();
    const enrollment = await findOwnEnrollment(Enrollment, req.params.id, req.user.id);
    if (!enrollment) return res.status(404).json({ message: "Inscription introuvable" });

    const { lessonId } = req.params;
    if (!enrollment.completedLessonIds.some((id) => id.toString() === lessonId)) {
      enrollment.completedLessonIds.push(lessonId);
    }
    enrollment.lastActivityAt = new Date();
    await enrollment.save();

    res.json(withProgress(enrollment, null));
  } catch (error) {
    next(error);
  }
};

/* -------------------- Apprenant : décocher une leçon -------------------- */
exports.unmarkLessonComplete = async (req, res, next) => {
  try {
    const Enrollment = getNumsalEnrollmentModel();
    const enrollment = await findOwnEnrollment(Enrollment, req.params.id, req.user.id);
    if (!enrollment) return res.status(404).json({ message: "Inscription introuvable" });

    const { lessonId } = req.params;
    enrollment.completedLessonIds = enrollment.completedLessonIds.filter(
      (id) => id.toString() !== lessonId
    );
    enrollment.lastActivityAt = new Date();
    await enrollment.save();

    res.json(withProgress(enrollment, null));
  } catch (error) {
    next(error);
  }
};

/* -------------------- Formateur : progression des inscrits à l'un de mes cours -------------------- */
exports.courseProgressForTrainer = async (req, res, next) => {
  try {
    const Course = getNumsalCourseModel();
    const Enrollment = getNumsalEnrollmentModel();

    const course = req.user.role === "ADMIN"
      ? await Course.findById(req.params.courseId)
      : await Course.findOne({ _id: req.params.courseId, trainerId: req.user.id });
    if (!course) return res.status(404).json({ message: "Cours introuvable" });

    const enrollments = await Enrollment.find({ courseId: course._id })
      .populate("learnerId", "name email")
      .sort({ lastActivityAt: -1 });

    const items = enrollments.map((e) => ({
      ...withProgress(e, course),
      learner: e.learnerId,
    }));

    res.json({ items });
  } catch (error) {
    next(error);
  }
};

/* -------------------- Tuteur : progression de mes apprenants assignés -------------------- */
exports.tutorView = async (req, res, next) => {
  try {
    const NumsalUser = getNumsalUserModel();
    const Enrollment = getNumsalEnrollmentModel();

    const tutor = await NumsalUser.findById(req.user.id).populate("assignedLearnerIds", "name email");
    const learners = tutor?.assignedLearnerIds || [];

    const results = await Promise.all(
      learners.map(async (learner) => {
        const enrollments = await Enrollment.find({ learnerId: learner._id }).populate(
          "courseId",
          "title lessons"
        );
        return {
          learner: { id: learner._id, name: learner.name, email: learner.email },
          courses: enrollments.map((e) => ({
            ...withProgress(e, e.courseId),
            courseTitle: e.courseId?.title,
          })),
        };
      })
    );

    res.json({ items: results });
  } catch (error) {
    next(error);
  }
};

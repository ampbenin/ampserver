const Report = require("../../models/gestionamp/Report");
const { generateReportData } = require("../../utils/gestionamp/reportGenerator");

/**
 * Générer un rapport (EC / IS)
 */
exports.generateReport = async (req, res) => {
  try {
    const { year } = req.body;

    const report = await Report.create({
      year,
      ...req.spaceFilter,
      generatedBy: req.user.id,
    });

    res.status(201).json(report);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

/**
 * Lister les rapports (par espace)
 */
exports.getReports = async (req, res) => {
  const reports = await Report.find(req.spaceFilter).sort({ year: -1 });
  res.json(reports);
};

/**
 * Validation ADMIN
 */
exports.validateReport = async (req, res) => {
  const report = await Report.findById(req.params.id);

  if (!report) {
    return res.status(404).json({ message: "Rapport introuvable" });
  }

  report.status = "VALIDATED";
  report.validatedBy = req.user.id;
  report.validatedAt = new Date();

  await report.save();

  res.json(report);
};

/**
 * Télécharger le rapport (PDF simulé)
 * Accessible uniquement si VALIDÉ et dans le bon espace
 */
exports.downloadReport = async (req, res) => {
  const report = await Report.findOne({
    _id: req.params.id,
    status: "VALIDATED",
    ...req.spaceFilter,
  });

  if (!report) {
    return res.status(403).json({
      message: "Rapport non validé ou hors espace",
    });
  }

  const data = await generateReportData({
    year: report.year,
    spaceFilter: req.spaceFilter,
  });

  res.json({
    report,
    data,
  });
};

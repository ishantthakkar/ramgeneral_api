const { normalizeNotes, enrichNotesWithAuthors } = require('./subdocumentHelpers');

const coerceSurveyNotes = (notes) => {
  if (notes === undefined || notes === null || notes === '') return [];

  if (typeof notes === 'string') {
    return normalizeNotes(notes).filter((item) => item.note);
  }

  if (Array.isArray(notes)) {
    return notes
      .map((item) => {
        if (typeof item === 'string') {
          const noteText = item.trim();
          return noteText
            ? { title: '', note: noteText, createdAt: new Date() }
            : null;
        }
        if (item && typeof item === 'object') {
          const noteText = (item.note ?? '').toString().trim();
          if (!noteText) return null;
          return {
            title: (item.title ?? '').toString().trim(),
            note: noteText,
            ...(item.user_id ? { user_id: item.user_id } : {}),
            createdAt: item.createdAt ? new Date(item.createdAt) : new Date(),
          };
        }
        return null;
      })
      .filter(Boolean);
  }

  return normalizeNotes(notes).filter((item) => item.note);
};

const surveyNotesNeedCoercion = (notes) => {
  if (notes === undefined || notes === null || notes === '') return true;
  if (typeof notes === 'string') return true;
  if (!Array.isArray(notes)) return true;
  return notes.some(
    (item) =>
      !item ||
      typeof item === 'string' ||
      typeof item !== 'object' ||
      !(item.note ?? '').toString().trim()
  );
};

const getRawSurveyNotes = (survey) => {
  if (!survey) return undefined;
  if (typeof survey.toObject === 'function') {
    return survey.toObject({ depopulate: true }).notes;
  }
  return survey.notes;
};

const sanitizeSurveyDocumentNotes = (survey) => {
  if (!survey) return survey;
  const coerced = coerceSurveyNotes(getRawSurveyNotes(survey));
  survey.set('notes', coerced);
  survey.markModified('notes');
  return survey;
};

const enrichSurveyNotesInObject = async (surveyObj) => {
  if (!surveyObj || typeof surveyObj !== 'object') return surveyObj;

  return {
    ...surveyObj,
    notes: await enrichNotesWithAuthors(coerceSurveyNotes(surveyObj.notes)),
    reopenNote: await enrichNotesWithAuthors(surveyObj.reopenNote || []),
    installationReopenNote: await enrichNotesWithAuthors(
      surveyObj.installationReopenNote || []
    ),
  };
};

module.exports = {
  coerceSurveyNotes,
  surveyNotesNeedCoercion,
  getRawSurveyNotes,
  sanitizeSurveyDocumentNotes,
  enrichSurveyNotesInObject,
};

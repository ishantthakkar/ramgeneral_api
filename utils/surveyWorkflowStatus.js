function hasValidConfirmDate(value) {
  if (value == null || value === '') {
    return false;
  }
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

function normalizeSurveyStatus(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, ' ');
}

function isSurveyVerifiedRecord(survey) {
  if (!survey || typeof survey !== 'object') {
    return false;
  }

  if (hasValidConfirmDate(survey.confirmDate)) {
    return true;
  }

  const status = normalizeSurveyStatus(survey.status);
  return status === 'completed' || status === 'verified';
}

function resolveSurveyWorkflowStatus(survey) {
  if (isSurveyVerifiedRecord(survey)) {
    return 'Verified';
  }

  const status = normalizeSurveyStatus(survey?.status);
  if (status === 'submitted') return 'Submitted';
  if (status === 'in progress') return 'In Progress';
  if (status === 'reopen' || status === 'reopened') return 'Reopened';
  if (status === 'pending edit approval') return 'Pending Approval';
  if (!status || status === 'draft' || status === 'pending') return 'Pending';

  return status.charAt(0).toUpperCase() + status.slice(1);
}

function attachSurveyWorkflowStatus(survey) {
  if (!survey || typeof survey !== 'object') {
    return survey;
  }

  return {
    ...survey,
    workflowStatus: resolveSurveyWorkflowStatus(survey),
    isSurveyVerified: isSurveyVerifiedRecord(survey),
  };
}

module.exports = {
  attachSurveyWorkflowStatus,
  isSurveyVerifiedRecord,
  resolveSurveyWorkflowStatus,
};

const mongoose = require('mongoose');
const Survey = require('./models/Survey');
const Customer = require('./models/Customer');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/ramgeneral';
const SURVEY_ID = process.argv[2] || '6a3bc0ff21eeea911a66789f';

async function main() {
  await mongoose.connect(MONGO_URL);

  const survey = await Survey.findById(SURVEY_ID).select('customer_id surveyName inspectionStatus quotationStatus');
  if (!survey) {
    throw new Error(`Survey not found: ${SURVEY_ID}`);
  }

  survey.inspectionStatus = 'verified';
  survey.inspectionDate = new Date();
  await survey.save();

  if (survey.customer_id) {
    await Customer.updateOne(
      { _id: survey.customer_id },
      { $set: { inspectionStatus: 'verified' } }
    );
  }

  console.log('Inspection verified for survey:', survey.surveyName || SURVEY_ID);
  console.log('  quotationStatus:', survey.quotationStatus);
  console.log('  inspectionStatus:', survey.inspectionStatus);

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error.message || error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

const { getAllUsaStates, getUsaStateByQuery } = require('../utils/usaStatesData');

exports.getUsaStates = (req, res) => {
  try {
    const stateQuery = req.query.state;

    if (stateQuery) {
      const entry = getUsaStateByQuery(stateQuery);
      if (!entry) {
        return res.status(404).json({
          message: 'State not found. Use a state code (e.g. NY) or full name (e.g. New York).',
        });
      }
      return res.status(200).json([entry]);
    }

    return res.status(200).json(getAllUsaStates());
  } catch (error) {
    return res.status(500).json({
      message: 'Failed to load USA states data.',
      error: error.message,
    });
  }
};

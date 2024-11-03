const  validateDateRange = (req, res, next) => {
    const { start, end } = req.query;

    if (!start || !end) {
        return res.status(400).json({
            error: 'Both start and end dates are required'
        });
    }

    const startDate = new Date(start);
    const endDate = new Date(end);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res.status(400).json({
            error: 'Invalid date format. Use YYYY-MM-DD'
        });
    }

    if (startDate > endDate) {
        return res.status(400).json({
            error: 'Start date must be before end date'
        });
    }

    req.validatedDates = {
        startDate,
        endDate
    };

    next();
};
module.exports = {validateDateRange}

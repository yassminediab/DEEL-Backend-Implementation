const express = require('express');
const bodyParser = require('body-parser');
const {sequelize} = require('./model')
const {getProfile} = require('./middleware/getProfile')
const app = express();
app.use(bodyParser.json());
app.set('sequelize', sequelize)
app.set('models', sequelize.models)

/**
 * FIX ME!
 * @returns contract by id
 */
app.get('/contracts/:id', getProfile, async (req, res) => {
    const { Contract } = req.app.get('models');
    const { id } = req.params;
    const profileId = req.profile.id;

    const contract = await Contract.findOne({
        where: {
            id,
            profileId
        }
    });

    if (!contract) return res.status(404).end();

    res.json(contract);
});

app.get('/contracts', getProfile, async (req, res) => {
    const { Contract } = req.app.get('models');
    const contract = await Contract.findAll({
        where: {
            [Op.or]: [
                { ContractorId: req.profile.id },
                { ClientId: req.profile.id }
            ],
            status: {
                [Op.ne]: 'terminated'
            }
        }
    });

    if (!contract) return res.status(404).end();

    res.json(contract);
});

app.get('/jobs/unpaid', getProfile, async (req, res) => {
    const jobs = await sequelize.models.Job.findAll({
        include: {
            model: sequelize.models.Contract,
            where: {
                [Op.or]: [
                    { ContractorId: req.profile.id },
                    { ClientId: req.profile.id }
                ],
                status: 'in_progress'
            },
            required: true
        },
        where: {
            paid: {
                [Op.not]: true
            }
        }
    });
    res.json(jobs);
});

app.post('/jobs/:job_id/pay', getProfile, async (req, res) => {
    const { job_id } = req.params;
    const transaction = await sequelize.transaction();

    try {
        const job = await sequelize.models.Job.findOne({
            include: {
                model: sequelize.models.Contract,
                where: { ClientId: req.profile.id },
                required: true
            },
            where: { id: job_id, paid: { [Op.not]: true } },
            lock: true,
            transaction
        });

        if (!job) {
            await transaction.rollback();
            return res.status(404).json({ error: 'Job not found or already paid' });
        }

        if (req.profile.balance < job.price) {
            await transaction.rollback();
            return res.status(400).json({ error: 'Insufficient funds' });
        }

        const contractor = await sequelize.models.Profile.findOne({
            where: { id: job.Contract.ContractorId },
            lock: true,
            transaction
        });

        await req.profile.update(
            { balance: req.profile.balance - job.price },
            { transaction }
        );
        await contractor.update(
            { balance: contractor.balance + job.price },
            { transaction }
        );
        await job.update(
            { paid: true, paymentDate: new Date() },
            { transaction }
        );

        await transaction.commit();
        res.json({ message: 'Payment successful' });
    } catch (error) {
        await transaction.rollback();
        res.status(500).json({ error: 'Payment failed' });
    }
});

app.post('/balances/deposit/:userId', getProfile, async (req, res) => {
    const { userId } = req.params;
    const { amount } = req.body;
    const transaction = await sequelize.transaction();

    try {
        // Calculate total jobs to pay
        const totalJobsToPay = await sequelize.models.Job.sum('price', {
            include: {
                model: sequelize.models.Contract,
                where: {
                    ClientId: userId,
                    status: 'in_progress'
                },
                required: true
            },
            where: {
                paid: {
                    [Op.not]: true
                }
            },
            transaction
        });

        const maxDeposit = totalJobsToPay * 0.25;
        if (amount > maxDeposit) {
            await transaction.rollback();
            return res.status(400).json({
                error: 'Deposit amount exceeds 25% of total jobs to pay'
            });
        }

        await sequelize.models.Profile.update(
            { balance: sequelize.literal(`balance + ${amount}`) },
            {
                where: { id: userId },
                transaction
            }
        );

        await transaction.commit();
        res.json({ message: 'Deposit successful' });
    } catch (error) {
        await transaction.rollback();
        res.status(500).json({ error: 'Deposit failed' });
    }
});


app.get('/admin/best-profession', async (req, res) => {
    const { start, end } = req.query;

    const result = await sequelize.models.Job.findOne({
        attributes: [
            [sequelize.col('Contract.Contractor.profession'), 'profession'],
            [sequelize.fn('SUM', sequelize.col('price')), 'earned']
        ],
        include: [{
            model: sequelize.models.Contract,
            include: [{
                model: sequelize.models.Profile,
                as: 'Contractor',
                attributes: ['profession']
            }]
        }],
        where: {
            paid: true,
            paymentDate: {
                [Op.between]: [start, end]
            }
        },
        group: ['Contract.Contractor.profession'],
        order: [[sequelize.fn('SUM', sequelize.col('price')), 'DESC']],
        raw: true
    });

    res.json({ profession: result?.profession });
});

app.get('/admin/best-clients', async (req, res) => {
    const { start, end, limit = 2 } = req.query;

    const clients = await sequelize.models.Job.findAll({
        attributes: [
            [sequelize.col('Contract.Client.id'), 'id'],
            [sequelize.literal("Contract.Client.firstName || ' ' || Contract.Client.lastName"), 'fullName'],
            [sequelize.fn('SUM', sequelize.col('price')), 'paid']
        ],
        include: [{
            model: sequelize.models.Contract,
            include: [{
                model: sequelize.models.Profile,
                as: 'Client',
                attributes: ['firstName', 'lastName']
            }]
        }],
        where: {
            paid: true,
            paymentDate: {
                [Op.between]: [start, end]
            }
        },
        group: ['Contract.Client.id'],
        order: [[sequelize.fn('SUM', sequelize.col('price')), 'DESC']],
        limit: parseInt(limit),
        raw: true
    });

    const formattedClients = clients.map(client => ({
        id: client.id,
        fullName: client.fullName,
        paid: parseFloat(client.paid)
    }));

    res.json(formattedClients);
});
module.exports = app;

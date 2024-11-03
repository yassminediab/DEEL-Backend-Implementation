const request = require('supertest');
const app = require('../src/app');
const { Profile, Contract, Job } = require('../src/model');

describe('DEEL BACKEND REST API', () => {
    beforeAll(async () => {
        await Profile.sync({ force: true });
        await Contract.sync({ force: true });
        await Job.sync({ force: true });

        await Promise.all([
            Profile.create({
                id: 1,
                firstName: 'Test',
                lastName: 'Client',
                profession: 'Test Buyer',
                balance: 1000,
                type: 'client'
            }),
            Profile.create({
                id: 2,
                firstName: 'Test',
                lastName: 'Contractor',
                profession: 'Test Worker',
                balance: 500,
                type: 'contractor'
            }),
            Contract.create({
                id: 1,
                terms: 'Test Contract',
                status: 'in_progress',
                ClientId: 1,
                ContractorId: 2
            }),
            Job.create({
                description: 'Test Job 1',
                price: 200,
                ContractId: 1,
                paid: true,
                paymentDate: '2024-01-15T19:11:26.737Z'
            }),
            Job.create({
                description: 'Test Job 2',
                price: 300,
                ContractId: 1,
                paid: false
            })
        ]);
    });

    describe('GET /contracts/:id', () => {
        it('should return 401 if profile_id header is missing', async () => {
            const response = await request(app).get('/contracts/1');
            expect(response.status).toBe(401);
        });

        it('should return 404 for non-existent contract', async () => {
            const response = await request(app)
                .get('/contracts/999')
                .set('profile_id', '1');
            expect(response.status).toBe(404);
        });

        it('should return contract if user is the client', async () => {
            const response = await request(app)
                .get('/contracts/1')
                .set('profile_id', '1');
            expect(response.status).toBe(200);
            expect(response.body.ClientId).toBe(1);
        });

        it('should return contract if user is the contractor', async () => {
            const response = await request(app)
                .get('/contracts/1')
                .set('profile_id', '2');
            expect(response.status).toBe(200);
            expect(response.body.ContractorId).toBe(2);
        });
    });

    describe('GET /contracts', () => {
        it('should return non-terminated contracts for client', async () => {
            const response = await request(app)
                .get('/contracts')
                .set('profile_id', '1');
            expect(response.status).toBe(200);
            expect(response.body.length).toBeGreaterThan(0);
            expect(response.body.every(c => c.status !== 'terminated')).toBe(true);
        });
    });

    describe('GET /jobs/unpaid', () => {
        it('should return unpaid jobs for active contracts', async () => {
            const response = await request(app)
                .get('/jobs/unpaid')
                .set('profile_id', '1');
            expect(response.status).toBe(200);
            expect(response.body.length).toBeGreaterThan(0);
            expect(response.body.every(job => !job.paid)).toBe(true);
        });
    });

    describe('POST /jobs/:job_id/pay', () => {
        it('should fail if client has insufficient funds', async () => {
            // Create a job with price higher than client balance
            const expensiveJob = await Job.create({
                description: 'Expensive Job',
                price: 2000,
                ContractId: 1,
                paid: false
            });

            const response = await request(app)
                .post(`/jobs/${expensiveJob.id}/pay`)
                .set('profile_id', '1');

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('Insufficient funds');
        });

        it('should successfully pay for a job', async () => {
            const response = await request(app)
                .post('/jobs/2/pay')
                .set('profile_id', '1');

            expect(response.status).toBe(200);
            expect(response.body.message).toBe('Payment successful');

            // Verify job was marked as paid
            const updatedJob = await Job.findByPk(2);
            expect(updatedJob.paid).toBe(true);

            // Verify balances were updated
            const updatedClient = await Profile.findByPk(1);
            const updatedContractor = await Profile.findByPk(2);
            expect(updatedClient.balance).toBe(700); // 1000 - 300
            expect(updatedContractor.balance).toBe(800); // 500 + 300
        });

        it('should fail for non-existent job', async () => {
            const response = await request(app)
                .post('/jobs/999/pay')
                .set('profile_id', '1');

            expect(response.status).toBe(404);
        });

        it('should fail for already paid job', async () => {
            const response = await request(app)
                .post('/jobs/2/pay')
                .set('profile_id', '1');

            expect(response.status).toBe(404);
            expect(response.body.error).toBe('Job not found or already paid');
        });

    });

    describe('POST /balances/deposit/:userId', () => {
        it('should not allow deposit exceeding 25% of jobs to pay', async () => {
            const response = await request(app)
                .post('/balances/deposit/1')
                .set('profile_id', '1')
                .send({ amount: 1000 });

            expect(response.status).toBe(400);
            expect(response.body.error).toContain('25%');


        });

        it('should successfully deposit allowed amount', async () => {
            const response = await request(app)
                .post('/balances/deposit/1')
                .set('profile_id', '1')
                .send({ amount: 50 });

            expect(response.status).toBe(200);
            expect(response.body.message).toBe('Deposit successful');
        });

        it('should fail if deposit exceeds 25% of unpaid jobs', async () => {
            const response = await request(app)
                .post('/balances/deposit/2')
                .set('profile_id', '2')
                .send({ amount: 1000 });

            expect(response.status).toBe(400);
            expect(response.body.error).toContain('25%');
        });

        it('should fail with negative amount', async () => {
            const response = await request(app)
                .post('/balances/deposit/2')
                .set('profile_id', '2')
                .send({ amount: -50 });

            expect(response.status).toBe(400);
        });

        it('should fail with negative amount', async () => {
            const response = await request(app)
                .post('/balances/deposit/2')
                .set('profile_id', '2')
                .send({ amount: -50 });

            expect(response.status).toBe(400);
        });
    });


    describe('GET /admin/best-profession', () => {
        it('should return the profession that earned the most', async () => {
            const response = await request(app)
                .get('/admin/best-profession')
                .query({
                    start: '2024-01-01',
                    end: '2024-12-31'
                });

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('profession');
            expect(response.body.profession).toBe('Test Worker');
        });

        it('should handle invalid date formats', async () => {
            const response = await request(app)
                .get('/admin/best-profession')
                .query({
                    start: 'invalid-date',
                    end: "2024-12-31"
                });

            expect(response.status).toBe(400);
        });
    });

    describe('GET /admin/best-clients', () => {
        it('should return the specified number of best paying clients', async () => {
            const response = await request(app)
                .get('/admin/best-clients')
                .query({
                    start: '2024-01-01',
                    end: '2024-12-31',
                    limit: 2
                });

            expect(response.status).toBe(200);
            expect(Array.isArray(response.body)).toBe(true);
            expect(response.body.length).toBeLessThanOrEqual(2);
            expect(response.body[0]).toHaveProperty('paid');
            expect(response.body[0]).toHaveProperty('fullName');
        });

        it('should use default limit of 2', async () => {
            const response = await request(app)
                .get('/admin/best-clients')
                .query({
                    start: '2024-01-01',
                    end: '2024-12-31'
                });

            expect(response.body.length).toBeLessThanOrEqual(2);
        });

        it('should handle custom limit parameter', async () => {
            const response = await request(app)
                .get('/admin/best-clients')
                .query({
                    start: '2024-01-01',
                    end: '2024-12-31',
                    limit: 1
                });

            expect(response.body.length).toBe(1);
        });
    });
});

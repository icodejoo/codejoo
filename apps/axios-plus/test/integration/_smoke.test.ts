// Smoke test — spins up the Bun server, verifies one Petstore endpoint
// answers with the ApiResponse envelope. This is the cheapest reproduction
// of the entire integration harness and a fast canary for plumbing problems.

import axios from 'axios';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type ServerHandle } from '../../server';

describe('integration smoke', () => {
    let server: ServerHandle;
    let baseURL: string;

    beforeAll(async () => {
        server = await startServer();
        baseURL = `http://localhost:${server.port}`;
    }, 15_000);

    afterAll(async () => {
        await server.close();
    });

    it('answers GET /pet/{petId} with ApiResponse envelope', async () => {
        const res = await axios.get(`${baseURL}/pet/42`);
        expect(res.status).toBe(200);
        expect(res.data.code).toBe('0000');
        expect(res.data.data.id).toBe(42);
        expect(res.data.data.name).toBe('doggie');
    });
});

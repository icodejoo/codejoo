import axios from 'axios';
import { create, normalizeRequest, normalizeResponse } from '../src';



const githubApi = create<model.MethodRefs>(axios.create({ baseURL: "https://api.github.com", adapter: 'fetch' }));
const internalApi = create<model.MethodRefs>(axios.create({ baseURL: "https://api.internal.example.com", adapter: 'fetch' }));


githubApi.use(normalizeRequest())
githubApi.use(normalizeResponse())

class TestApi {
    static query = githubApi.get("/pet/findByStatus")
}



await TestApi.query({ status: 1 }, {
    key:1,
})
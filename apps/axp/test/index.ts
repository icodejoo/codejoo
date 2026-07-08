import axios from 'axios';
import { Axp, axpFilter as filter, axpNormalize as normalize } from '../src';
import { use } from './helpers/install';



const githubApi = Axp.create<model.MethodRefs>(axios.create({ baseURL: "https://api.github.com", adapter: 'fetch' }));
const internalApi = Axp.create<model.MethodRefs>(axios.create({ baseURL: "https://api.internal.example.com", adapter: 'fetch' }));


use(githubApi, filter())
use(githubApi, normalize())

class TestApi {
    static query = githubApi.get("/pet/findByStatus")
}



await TestApi.query({ status: 1 }, {
    key:1,
})
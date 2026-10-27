import axios from 'axios';
import { Axp, axpFilter as filter, axpNormalize as normalize } from '../src';
import { use } from './helpers/install';



const githubApi = Axp.create<model.MethodRefs>(axios.create({ baseURL: "https://api.github.com", adapter: 'fetch' }));


use(githubApi, filter())
use(githubApi, normalize())

class TestApi {
    static query = githubApi.get("/pet/findByStatus")
}



// @ts-expect-error 演示生成 schema 会拒绝错误的状态参数。
await TestApi.query({ status: 1 }, {
    key:1,
})

import { generate, configureTypescript, configureBase } from '@codejoo/openapi2lang';

generate(configureBase({
    source: "./test/mock.json"
}), [
    configureTypescript()
])
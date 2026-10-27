/* ─────────────────────────────────────────────────────────────────────────────
 * 本地 MethodRefs 扩展模板（方法优先）
 *
 * Copy this file to `types/local/<feature>.d.ts` to register paths that the
 * codegen hasn't caught up with yet. The interface below defines a local
 * schema extending `model.MethodRefs` from `types/paths.d.ts`.
 * Use Axp.create<model.LocalMethodRefs>() to infer these additional paths.
 * 已有 get/post 属性不能通过声明合并增加不同类型的成员，因此使用继承与交叉类型。
 *
 * Delete the file (or just the entry) once codegen ships the official type.
 *
 * Tuple shape — must match the codegen format:
 *     [response: <ResponseType>, request: [payload: <PayloadType>] | []]
 * ──────────────────────────────────────────────────────────────────────────── */

declare namespace model {
  /** 在生成 schema 上扩展尚未进入 OpenAPI 的本地接口。 */
  interface LocalMethodRefs extends MethodRefs {
    // Example: a POST endpoint not yet in the spec
    /** 保留生成的 POST 路径并新增草稿接口。 */
    post: MethodRefs['post'] & {
      /** 创建草稿宠物。 */
      '/pet/draft': [response: model.Pet, request: [payload: model.req.AddPet]];
    };

    // Example: an experimental GET with no payload and unknown response shape
    /** 保留生成的 GET 路径并新增实验接口。 */
    get: MethodRefs['get'] & {
      /** 查询实验性接口。 */
      '/experimental/whatever': [response: unknown, request: []];
    };
  }
}

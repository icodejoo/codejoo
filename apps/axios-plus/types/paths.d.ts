//!!!脚本自动生成，请勿修改;

declare namespace model {
  type Paths =
    | '/pet'
    | '/pet/findByStatus'
    | '/pet/findByTags'
    | '/pet/{petId}'
    | '/pet/{petId}/uploadImage'
    | '/store/inventory'
    | '/store/order'
    | '/store/order/{orderId}'
    | '/user'
    | '/user/createWithList'
    | '/user/login'
    | '/user/logout'
    | '/user/{username}'

  interface PathRefs {
    '/pet': {
      /** Add a new pet to the store. */
      post: [response: model.Pet, request: [payload: model.req.AddPet]]
      /**
       * Update an existing pet.
       *
       * Update an existing pet by Id.
       */
      put: [response: model.Pet, request: [payload: model.req.UpdatePet]]
    }
    '/pet/findByStatus': {
      /**
       * Finds Pets by status.
       *
       * Multiple status values can be provided with comma separated strings.
       */
      get: [response: Array<model.Pet>, request: [payload: model.req.FindPetsByStatus]]
    }
    '/pet/findByTags': {
      /**
       * Finds Pets by tags.
       *
       * Multiple tags can be provided with comma separated strings. Use tag1, tag2, tag3 for testing.
       */
      get: [response: Array<model.Pet>, request: [payload: model.req.FindPetsByTags]]
    }
    '/pet/{petId}': {
      /**
       * Find pet by ID.
       *
       * Returns a single pet.
       */
      get: [response: model.Pet, request: [payload: model.req.GetPetById]]
      /**
       * Updates a pet in the store with form data.
       *
       * Updates a pet resource based on the form data.
       */
      post: [response: model.Pet, request: [payload: model.req.UpdatePetWithForm]]
      /**
       * Deletes a pet.
       *
       * Delete a pet.
       */
      delete: [response: unknown, request: [payload: model.req.DeletePet]]
    }
    '/pet/{petId}/uploadImage': {
      /**
       * Uploads an image.
       *
       * Upload image of the pet.
       */
      post: [response: model.ApiResponse, request: [payload: model.req.UploadFile]]
    }
    '/store/inventory': {
      /**
       * Returns pet inventories by status.
       *
       * Returns a map of status codes to quantities.
       */
      get: [response: Record<string, number>, request: []]
    }
    '/store/order': {
      /**
       * Place an order for a pet.
       *
       * Place a new order in the store.
       */
      post: [response: model.Order, request: [payload: model.req.PlaceOrder]]
    }
    '/store/order/{orderId}': {
      /**
       * Find purchase order by ID.
       *
       * For valid response try integer IDs with value <= 5 or > 10. Other values will generate exceptions.
       */
      get: [response: model.Order, request: [payload: model.req.GetOrderById]]
      /**
       * Delete purchase order by identifier.
       *
       * For valid response try integer IDs with value < 1000. Anything above 1000 or non-integers will generate API errors.
       */
      delete: [response: unknown, request: [payload: model.req.DeleteOrder]]
    }
    '/user': {
      /**
       * Create user.
       *
       * This can only be done by the logged in user.
       */
      post: [response: model.User, request: [payload: model.req.CreateUser]]
    }
    '/user/createWithList': {
      /** Creates list of users with given input array. */
      post: [response: model.User, request: [payload: model.req.CreateUsersWithListInput]]
    }
    '/user/login': {
      /**
       * Logs user into the system.
       *
       * Log into the system.
       */
      get: [response: string, request: [payload: model.req.LoginUser]]
    }
    '/user/logout': {
      /**
       * Logs out current logged in user session.
       *
       * Log user out of the system.
       */
      get: [response: unknown, request: []]
    }
    '/user/{username}': {
      /**
       * Get user by user name.
       *
       * Get user detail based on username.
       */
      get: [response: model.User, request: [payload: model.req.GetUserByName]]
      /**
       * Update user resource.
       *
       * This can only be done by the logged in user.
       */
      put: [response: unknown, request: [payload: model.req.UpdateUser]]
      /**
       * Delete user resource.
       *
       * This can only be done by the logged in user.
       */
      delete: [response: unknown, request: [payload: model.req.DeleteUser]]
    }
  }
}

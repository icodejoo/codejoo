//!!!脚本自动生成，请勿修改;

declare namespace model.req {
  /**
   * Finds Pets by status.
   *
   * Multiple status values can be provided with comma separated strings.
   */
  type FindPetsByStatus = {
    /**
     * Status values that need to be considered for filter
     *
     * @default available
     */
    status: model.PetStatus;
  };

  /**
   * Finds Pets by tags.
   *
   * Multiple tags can be provided with comma separated strings. Use tag1, tag2, tag3 for
   * testing.
   */
  type FindPetsByTags = {
    /**
     * Tags to filter by
     */
    tags: Array<string>;
  };

  /**
   * Find pet by ID.
   *
   * Returns a single pet.
   */
  type GetPetById = {
    /**
     * ID of pet to return
     */
    petId: number;
  };

  /**
   * Updates a pet in the store with form data.
   *
   * Updates a pet resource based on the form data.
   */
  type UpdatePetWithForm = {
    /**
     * Name of pet that needs to be updated
     */
    name?: string;
    /**
     * ID of pet that needs to be updated
     */
    petId: number;
    /**
     * Status of pet that needs to be updated
     */
    status?: string;
  };

  /**
   * Deletes a pet.
   *
   * Delete a pet.
   */
  type DeletePet = {
    api_key?: string;
    /**
     * Pet id to delete
     */
    petId: number;
  };

  /**
   * Uploads an image.
   *
   * Upload image of the pet.
   */
  type UploadFile = {
    /**
     * Additional Metadata
     */
    additionalMetadata?: string;
    body?: any;
    /**
     * ID of pet to update
     */
    petId: number;
  };

  /**
   * Find purchase order by ID.
   *
   * For valid response try integer IDs with value <= 5 or > 10. Other values will generate
   * exceptions.
   */
  type GetOrderById = {
    /**
     * ID of order that needs to be fetched
     */
    orderId: number;
  };

  /**
   * Delete purchase order by identifier.
   *
   * For valid response try integer IDs with value < 1000. Anything above 1000 or non-integers
   * will generate API errors.
   */
  type DeleteOrder = {
    /**
     * ID of the order that needs to be deleted
     */
    orderId: number;
  };

  /**
   * Logs user into the system.
   *
   * Log into the system.
   */
  type LoginUser = {
    /**
     * The password for login in clear text
     */
    password?: string;
    /**
     * The user name for login
     */
    username?: string;
  };

  /**
   * Get user by user name.
   *
   * Get user detail based on username.
   */
  type GetUserByName = {
    /**
     * The name that needs to be fetched. Use user1 for testing
     */
    username: string;
  };

  /**
   * Delete user resource.
   *
   * This can only be done by the logged in user.
   */
  type DeleteUser = {
    /**
     * The name that needs to be deleted
     */
    username: string;
  };

  /** Add a new pet to the store. */
  interface AddPet extends model.Pet {
    /**
     * Status values that need to be considered for filter
     *
     * @default available
     */
    status: model.PetStatus;
  }
  /**
   * Update an existing pet.
   *
   * Update an existing pet by Id.
   */
  interface UpdatePet extends model.Pet {}
  /**
   * Place an order for a pet.
   *
   * Place a new order in the store.
   */
  interface PlaceOrder extends model.Order {}
  /**
   * Create user.
   *
   * This can only be done by the logged in user.
   */
  interface CreateUser extends model.User {}
  /** Creates list of users with given input array. */
  type CreateUsersWithListInput = Array<model.User>;
  /**
   * Update user resource.
   *
   * This can only be done by the logged in user.
   */
  interface UpdateUser extends model.User {
    /** name that need to be deleted */
    username: string;
  }
}

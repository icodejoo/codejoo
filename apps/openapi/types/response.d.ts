//!!!脚本自动生成，请勿修改;

declare namespace model {
  /**
   * Order Status
   *
   * @example approved
   */
  type OrderStatus = "placed" | "approved" | "delivered";

  /**
   * pet status in the store
   *
   * Status values that need to be considered for filter
   *
   * @default available
   */
  type PetStatus = "available" | "pending" | "sold";

  type Order = {
    complete?: boolean;
    /**
     * @example 10
     */
    id?: number;
    /**
     * @example 198772
     */
    petId?: number;
    /**
     * @example 7
     */
    quantity?: number;
    shipDate?: string;
    /**
     * Order Status
     *
     * @example approved
     */
    status?: OrderStatus;
  };

  type User = {
    /**
     * @example john@email.com
     */
    email?: string;
    /**
     * @example John
     */
    firstName?: string;
    /**
     * @example 10
     */
    id?: number;
    /**
     * @example James
     */
    lastName?: string;
    /**
     * @example 12345
     */
    password?: string;
    /**
     * @example 12345
     */
    phone?: string;
    /**
     * @example theUser
     */
    username?: string;
    /**
     * User Status
     *
     * @example 1
     */
    userStatus?: number;
  };

  type Pet = {
    category?: Category;
    /**
     * @example 10
     */
    id?: number;
    /**
     * @example doggie
     */
    name: string;
    photoUrls: Array<string>;
    /**
     * pet status in the store
     */
    status?: PetStatus;
    tags?: Array<Tag>;
  };

  type Category = {
    /**
     * @example 1
     */
    id?: number;
    /**
     * @example Dogs
     */
    name?: string;
  };

  type Tag = {
    id?: number;
    name?: string;
  };

  type ApiResponse = {
    code?: number;
    message?: string;
    type?: string;
  };
}

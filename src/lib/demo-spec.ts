export const demoSpecText = `openapi: 3.1.0
info:
  title: SpecPilot Demo Orders API
  version: 1.4.0
  description: >
    A demo commerce API for generating, executing, and reporting API test suites.
servers:
  - url: /api/demo/v1
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
  schemas:
    Money:
      type: object
      required: [amount, currency]
      properties:
        amount:
          type: number
          example: 49.99
        currency:
          type: string
          enum: [USD, INR]
    OrderItem:
      type: object
      required: [sku, quantity]
      properties:
        sku:
          type: string
          example: sku_solar_mug
        quantity:
          type: integer
          minimum: 1
          example: 2
        unitPrice:
          $ref: '#/components/schemas/Money'
    CreateOrderRequest:
      type: object
      required: [customerEmail, items]
      properties:
        customerEmail:
          type: string
          format: email
        notes:
          type: string
          example: Deliver before noon
        items:
          type: array
          minItems: 1
          items:
            $ref: '#/components/schemas/OrderItem'
    Order:
      type: object
      required: [id, status, total]
      properties:
        id:
          type: string
          example: ord_demo_001
        status:
          type: string
          enum: [pending, paid, refunded]
        total:
          $ref: '#/components/schemas/Money'
        createdAt:
          type: string
          format: date-time
    RefundRequest:
      type: object
      required: [reason]
      properties:
        reason:
          type: string
          example: customer_requested
        amount:
          $ref: '#/components/schemas/Money'
paths:
  /health:
    get:
      summary: API health check
      tags: [system]
      responses:
        "200":
          description: Service is healthy
  /orders:
    get:
      summary: List orders
      tags: [orders]
      security:
        - bearerAuth: []
      parameters:
        - in: query
          name: status
          schema:
            type: string
            enum: [pending, paid, refunded]
      responses:
        "200":
          description: Orders returned
          content:
            application/json:
              schema:
                type: object
                properties:
                  orders:
                    type: array
                    items:
                      $ref: '#/components/schemas/Order'
        "401":
          description: Missing or invalid token
    post:
      summary: Create an order
      tags: [orders]
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateOrderRequest'
      responses:
        "201":
          description: Order created
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Order'
        "400":
          description: Malformed payload
        "401":
          description: Missing or invalid token
        "422":
          description: Validation failed
  /orders/{orderId}:
    parameters:
      - in: path
        name: orderId
        required: true
        schema:
          type: string
    get:
      summary: Fetch a single order
      tags: [orders]
      security:
        - bearerAuth: []
      responses:
        "200":
          description: Order returned
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Order'
        "401":
          description: Missing or invalid token
        "404":
          description: Order not found
  /orders/{orderId}/refund:
    post:
      summary: Refund an order
      tags: [orders, finance]
      security:
        - bearerAuth: []
      parameters:
        - in: path
          name: orderId
          required: true
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/RefundRequest'
      responses:
        "200":
          description: Refund accepted
        "400":
          description: Invalid refund request
        "401":
          description: Missing or invalid token
        "404":
          description: Order not found
`;

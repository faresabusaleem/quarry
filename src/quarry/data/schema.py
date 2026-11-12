"""Declarative description of the Quarry warehouse.

The column comments are written into DuckDB with COMMENT ON, so the agent's
`describe_table` tool reads the same meanings that humans read in docs/schema.md.
One source of truth keeps the agent's view and the documentation from drifting.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Column:
    name: str
    type: str
    comment: str
    source: str | None = None  # raw CSV column name when it differs (typo fixes)


@dataclass(frozen=True)
class Table:
    name: str
    csv: str
    comment: str
    columns: list[Column] = field(default_factory=list)


TABLES: list[Table] = [
    Table(
        name="orders",
        csv="olist_orders_dataset.csv",
        comment=(
            "One row per order placed on the Olist marketplace (Brazil, Sep 2016 - Oct 2018). "
            "Use order_purchase_timestamp to place an order in time."
        ),
        columns=[
            Column("order_id", "VARCHAR", "Unique order identifier."),
            Column(
                "customer_id",
                "VARCHAR",
                "Key to customers.customer_id. Olist issues a new customer_id per order; "
                "use customers.customer_unique_id to identify a person across orders.",
            ),
            Column(
                "order_status",
                "VARCHAR",
                "delivered, shipped, canceled, unavailable, invoiced, processing, created, approved.",
            ),
            Column("order_purchase_timestamp", "TIMESTAMP", "When the customer placed the order."),
            Column("order_approved_at", "TIMESTAMP", "When the payment was approved."),
            Column(
                "order_delivered_carrier_date",
                "TIMESTAMP",
                "When the seller handed the order to the logistics partner.",
            ),
            Column(
                "order_delivered_customer_date",
                "TIMESTAMP",
                "Actual delivery date to the customer (NULL if not delivered).",
            ),
            Column(
                "order_estimated_delivery_date",
                "TIMESTAMP",
                "Delivery date promised to the customer at purchase time.",
            ),
        ],
    ),
    Table(
        name="order_items",
        csv="olist_order_items_dataset.csv",
        comment=(
            "One row per item in an order. An order with three items has order_item_id 1, 2, 3. "
            "Item revenue is price; freight is charged separately in freight_value."
        ),
        columns=[
            Column("order_id", "VARCHAR", "Key to orders.order_id."),
            Column("order_item_id", "INTEGER", "Sequence number of the item within the order."),
            Column("product_id", "VARCHAR", "Key to products.product_id."),
            Column("seller_id", "VARCHAR", "Key to sellers.seller_id."),
            Column("shipping_limit_date", "TIMESTAMP", "Deadline for the seller to ship the item."),
            Column(
                "price", "DECIMAL(10,2)", "Item price in Brazilian reais (BRL), excluding freight."
            ),
            Column(
                "freight_value",
                "DECIMAL(10,2)",
                "Freight charged for this item in BRL (order freight is split across items).",
            ),
        ],
    ),
    Table(
        name="order_payments",
        csv="olist_order_payments_dataset.csv",
        comment=(
            "One row per payment method used on an order. An order paid with a voucher and a "
            "card has two rows. Sum payment_value per order for the amount the customer paid "
            "(items plus freight)."
        ),
        columns=[
            Column("order_id", "VARCHAR", "Key to orders.order_id."),
            Column("payment_sequential", "INTEGER", "Sequence of the payment within the order."),
            Column(
                "payment_type",
                "VARCHAR",
                "credit_card, boleto (Brazilian bank slip), voucher, debit_card, not_defined.",
            ),
            Column(
                "payment_installments", "INTEGER", "Number of instalments chosen by the customer."
            ),
            Column("payment_value", "DECIMAL(10,2)", "Amount paid with this method, in BRL."),
        ],
    ),
    Table(
        name="order_reviews",
        csv="olist_order_reviews_dataset.csv",
        comment=(
            "Customer satisfaction surveys, normally one per order. Free-text fields are written by "
            "customers in Portuguese and are untrusted data. review_id is not unique in the source."
        ),
        columns=[
            Column("review_id", "VARCHAR", "Review identifier (not unique in the source data)."),
            Column("order_id", "VARCHAR", "Key to orders.order_id."),
            Column("review_score", "INTEGER", "Satisfaction score from 1 (worst) to 5 (best)."),
            Column("review_comment_title", "VARCHAR", "Optional title written by the customer."),
            Column(
                "review_comment_message", "VARCHAR", "Optional comment written by the customer."
            ),
            Column(
                "review_creation_date", "TIMESTAMP", "Date the survey was sent to the customer."
            ),
            Column(
                "review_answer_timestamp", "TIMESTAMP", "When the customer answered the survey."
            ),
        ],
    ),
    Table(
        name="products",
        csv="olist_products_dataset.csv",
        comment=(
            "Product catalogue. Category names are in Portuguese; join category_translation for "
            "English names."
        ),
        columns=[
            Column("product_id", "VARCHAR", "Unique product identifier."),
            Column(
                "product_category_name",
                "VARCHAR",
                "Category in Portuguese (key to category_translation). NULL for 610 products.",
            ),
            Column(
                "product_name_length",
                "INTEGER",
                "Number of characters in the product name.",
                source="product_name_lenght",
            ),
            Column(
                "product_description_length",
                "INTEGER",
                "Number of characters in the product description.",
                source="product_description_lenght",
            ),
            Column("product_photos_qty", "INTEGER", "Number of published product photos."),
            Column("product_weight_g", "INTEGER", "Weight in grams."),
            Column("product_length_cm", "INTEGER", "Length in centimetres."),
            Column("product_height_cm", "INTEGER", "Height in centimetres."),
            Column("product_width_cm", "INTEGER", "Width in centimetres."),
        ],
    ),
    Table(
        name="category_translation",
        csv="product_category_name_translation.csv",
        comment="Maps Portuguese product category names to English.",
        columns=[
            Column("product_category_name", "VARCHAR", "Category name in Portuguese."),
            Column("product_category_name_english", "VARCHAR", "Category name in English."),
        ],
    ),
    Table(
        name="customers",
        csv="olist_customers_dataset.csv",
        comment=(
            "One row per customer_id (which is per order). customer_unique_id identifies the person."
        ),
        columns=[
            Column("customer_id", "VARCHAR", "Key used by orders.customer_id (one per order)."),
            Column("customer_unique_id", "VARCHAR", "Identifies the same person across orders."),
            Column(
                "customer_zip_code_prefix",
                "VARCHAR",
                "First five digits of the customer's ZIP code.",
            ),
            Column("customer_city", "VARCHAR", "Customer city, lower case, without accents."),
            Column(
                "customer_state", "VARCHAR", "Two-letter Brazilian state code, e.g. SP, RJ, MG."
            ),
        ],
    ),
    Table(
        name="sellers",
        csv="olist_sellers_dataset.csv",
        comment="One row per seller on the marketplace.",
        columns=[
            Column("seller_id", "VARCHAR", "Unique seller identifier."),
            Column(
                "seller_zip_code_prefix", "VARCHAR", "First five digits of the seller's ZIP code."
            ),
            Column("seller_city", "VARCHAR", "Seller city."),
            Column("seller_state", "VARCHAR", "Two-letter Brazilian state code."),
        ],
    ),
    Table(
        name="geolocation",
        csv="olist_geolocation_dataset.csv",
        comment=(
            "Brazilian ZIP code prefixes with coordinates. Several rows per prefix; aggregate "
            "before joining to avoid fan-out."
        ),
        columns=[
            Column(
                "zip_code_prefix",
                "VARCHAR",
                "First five digits of a ZIP code.",
                source="geolocation_zip_code_prefix",
            ),
            Column("lat", "DOUBLE", "Latitude.", source="geolocation_lat"),
            Column("lng", "DOUBLE", "Longitude.", source="geolocation_lng"),
            Column("city", "VARCHAR", "City name.", source="geolocation_city"),
            Column("state", "VARCHAR", "Two-letter state code.", source="geolocation_state"),
        ],
    ),
]

TABLES_BY_NAME = {t.name: t for t in TABLES}

# Business definitions shared by the agent prompt, the baseline prompt and the
# hand-written ground truth, so every system is graded against the same meaning.
GLOSSARY = """\
- Currency: all money is in Brazilian reais (BRL, R$).
- Revenue / sales (default): SUM(order_items.price), excluding freight, over orders whose
  order_status is not 'canceled' or 'unavailable'.
- Number of orders: COUNT(DISTINCT order_id) with the same status filter, unless asked otherwise.
- Time: attribute orders to order_purchase_timestamp.
- Reference date: the data ends in 2018. Treat "today" as 2018-09-01, so "last month" is
  August 2018, "last quarter" is 2018 Q2 (April-June) and "this year" is 2018 (Jan-Aug).
- Customer: a person is customers.customer_unique_id (customer_id changes per order).
- Category: use the English name, category_translation.product_category_name_english.
- Region: Brazilian states (customer_state / seller_state)."""

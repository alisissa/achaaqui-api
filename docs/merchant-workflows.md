# Merchant catalog workflows

Implemented 6 September 2026. These screens and endpoints are for trusted
administrators operating on behalf of merchants. Merchant accounts and roles
are not implemented; never share the server-side API key with merchants.

## Templates and imports

The admin Imports page downloads blank CSV or XLSX files. The merchant catalog
also downloads that merchant's current active offers, suitable for editing and
re-uploading. Blank templates contain headers only, not pretend inventory. Excel
templates include a separate Instructions sheet and text-formatted columns.
The optional template query `locale=pt-BR` translates the Excel instructions;
canonical headers and worksheet names remain unchanged. The default is English.
Current-offer downloads include at most 500 offers; larger catalogs receive an
explicit error rather than a silently truncated export. Use smaller batches in
the blank template until paginated exports are implemented.

| Column | Rules |
| --- | --- |
| merchantSku | Required; unique to this merchant; maximum 120 characters. Normalized to uppercase. Keep as Text in Excel. |
| productName | Required; maximum 240 characters. Descriptive only, not a fuzzy-match key. |
| brand / model | Optional; maximum 120 / 160 characters. Imports do not edit shared product metadata. |
| barcode | Exact existing catalog barcode required for a new SKU. Keep leading zeros; maximum 32 normalized characters. |
| price | Required and positive, maximum two decimal places. Prefer `1299.00` or `1299,00`, without currency symbols. Ambiguous `1.299` is rejected. |
| currency | Required; BRL, USD, or PYG in the current configuration. No cross-currency price ranking. |
| stock | Optional integer from 0 to 100000000. Empty means unknown, not zero. |
| availability | `IN_STOCK`, `OUT_OF_STOCK`, or `UNKNOWN`; blank infers from stock. Contradictory stock/availability is blocked. |

CSV is UTF-8, comma-delimited, with quoted values as needed (including comma
decimal prices). Common English/Portuguese header aliases such as `sku`,
`produto`, `preço`, `moeda`, and `estoque` are supported. Duplicate canonical
headers, including aliases for the same column, are rejected. Unmapped columns
do not change catalog fields. Merchant-specific mapping profiles are not yet
available.

CSV exports prefix formula-like values with an apostrophe to protect spreadsheet
users. This can change the literal exported value; prefer XLSX for a lossless
round trip when a SKU/name starts with `=`, `+`, `-`, or `@`. Do not remove that
protection and then open untrusted CSV values as spreadsheet formulas.

File limits: 2 MB, 500 data rows, and 32 columns. XLSX additionally allows at most
10 MB of actual expanded ZIP data and 100 ZIP entries. Use one visible data
worksheet; an optional worksheet named exactly `Instructions` is ignored.
Numeric barcode cells, formulas, dates, hyperlinks, rich text, hidden data rows,
merged cells, encrypted archives, macros, and embedded objects are rejected.
Numeric SKUs are accepted only as nonnegative integers of at most 15 digits with
`General`, `0`, or `@` formatting. Each receives a leading-zero warning requiring
explicit acknowledgement before commit, including unchanged rows. Do not guess
lost zeros: re-enter the original identifier as Text when necessary. Boolean
availability cells and textual TRUE/FALSE values are supported; contradictory
stock still blocks the row. `.numbers`, `.xls`, `.xlsm`, and renamed arbitrary
files are not supported. In Apple Numbers, export to Excel (.xlsx) or CSV first.

Matching checks the merchant's existing SKU first, then an exact catalog
barcode. A supplied conflicting barcode blocks the row. Names never silently
create or choose a product. Add missing canonical products through **Add
product → Register a new product**, then import their offers.

Upload only creates staged rows. Review the preview, including blocked rows and
warnings. Pressing Commit is the explicit write action; warning acknowledgement
starts unchecked. Valid rows can commit while invalid rows remain skipped, so
inspect the complete preview and correct/re-upload rejected rows. Cancellation
before commit leaves live offers unchanged. Repeating the same committed import
does not duplicate writes or history. Uploading a file again creates a separate
preview, which is checked against current values.

Imports and manual writes acquire the same merchant/product transaction locks
and re-read current state. An edit, removal, or other import after preview
invalidates that snapshot. Re-upload and review; never force a stale commit.
READY previews created before this version's timestamp snapshots must also be
re-uploaded. No migration is needed for the new snapshot field, which is stored
in the existing normalized JSON.

Actual price/currency changes create history with their real predecessor and
CSV/XLSX source. Verified unchanged rows refresh freshness without adding price
history. Imports never restore removed offers; restore explicitly in the admin.

## Individual maintenance

Open a merchant's catalog to search active or removed offers and add one at a
time. Select an existing product, or enter a new product's name, brand, category,
optional model/barcode, and first offer together. Duplicate barcodes, product
assignments, and merchant SKUs are rejected. A failure rolls back the entire
new-product/offer operation.

Edits change the merchant SKU, price/currency, stock, availability, and visibility.
They require confirmation, with additional acknowledgement for suspicious price
or currency changes and unknown stock/availability. Stale forms are rejected;
reload and review before retrying. Removing an offer is a reversible hide, not
deletion of the shared product. It preserves other merchants and price history.
Restoring uses the edit form with visibility set to Active.

Price history records manual price changes, including the initial offer. It is
not yet a full actor-based activity log for stock, visibility, or profile edits.

## Protected API surface

All paths below are under `/v1/admin` and require the server-side bearer key.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/imports/template?format=csv\|xlsx&merchantId=optional-uuid` | Blank or current-offer template |
| POST | `/imports/csv`, `/imports/xlsx` | Multipart `merchantId` and `file`; stage and preview |
| GET | `/imports`, `/imports/:id` | History and row preview |
| POST | `/imports/:id/commit`, `/imports/:id/cancel` | Explicit commit or cancellation |
| GET | `/catalog/products` | Paginated product selection, including products without offers |
| GET, POST | `/merchants/:merchantId/offers` | Scoped list or create |
| GET, PATCH, DELETE | `/merchants/:merchantId/offers/:offerId` | Detail, edit/restore, soft removal |

Create chooses exactly one of `productId` or `newProduct`. Money is a decimal
string. Mutation bodies require literal `confirmed: true`; updates/removals
also require the last response's `expectedUpdatedAt`. `confirmWarnings` is an
optional boolean. Invalid/unknown fields are rejected. Offer IDs are always
resolved under the supplied merchant ID, but authenticated merchant ownership
must still be implemented before public self-service.

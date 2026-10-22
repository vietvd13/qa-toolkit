# Kiểm thử API — hướng dẫn và contract

Tài liệu cho tester dùng công cụ và người sửa code. Hướng dẫn bấm từng bước có trong [extension/README.md](../extension/README.md#kiểm-thử-api), bối cảnh giao diện trong [api-test-ux.md](api-test-ux.md).

## Chạy công cụ

- **Extension:** mở Bộ công cụ → **Kiểm thử API** (menu ⋮ → *Mở trong tab riêng* để có toàn màn hình). Không cần cài thêm gì.
- **Bản web:** `npm run ui` rồi mở `http://localhost:3000`. Request đi qua `/api/proxy` của `node/server.js`. Muốn khoá cứng danh sách host ở phía máy chủ thì đặt biến môi trường `QA_ALLOWED_HOSTS` (cách nhau bằng dấu phẩy); khi đó host phải nằm trong cả danh sách của máy chủ lẫn danh sách tester nhập.

Extension và bản web lưu dữ liệu ở hai nơi khác nhau, không tự đồng bộ: muốn chuyển thì **Export / Import workspace**.

## Luồng sử dụng

1. **Request đầu tiên:** *Dán cURL / Fetch* (Postman: Code `</>` → cURL; DevTools: Copy as cURL / Copy as fetch). Tool đọc chữ (không chạy lệnh), cho xem lại các thay đổi đề xuất (tắt header trình duyệt, chuyển token thành biến bí mật, tách `{{baseUrl}}`, cho phép host) rồi mới áp dụng → **Send** → xem Response. Không cần tạo collection hay environment trước.
2. **Lưu lại:** *Lưu vào collection*; tổ chức bằng Collection › Folder › Request ở thanh bên trái.
3. **Environment:** DEV / STAGING / PROD có sẵn, tạo thêm tuỳ ý. Đổi environment ở thanh trên cùng là đổi `{{baseUrl}}`, token, host được phép cho mọi request.
4. **Test case:** tab **Tests** của request: thêm bằng form, nhập Excel, hoặc dán JSON do AI chuyển từ Excel.
5. **Runner:** chạy một request, folder, collection hoặc **Preset** đã lưu. Xem kết quả, evidence, **Export Excel / ZIP**.

## Mô hình workspace

```text
Workspace
├── Collections → Folders (lồng nhau) → Requests (+ Test Suite, Scripts, rule lưu biến)
├── Requests “Chưa lưu” (chưa thuộc collection)
├── Environments (không giới hạn, mặc định DEV / STAGING / PROD)
├── Globals (biến + Allowed hosts dùng chung)
├── Run Presets
└── Kết quả lần chạy gần nhất (đã che dữ liệu nhạy cảm)
```

Mọi thực thể có **id ổn định** (`col_…`, `fld_…`, `req_…`, `env_…`, `pre_…`), không dùng vị trí trong mảng làm định danh. Thứ tự con nằm trong `children` của cha; quan hệ cha-con chuẩn là `parentId` của con. Domain: `extension/tools/api-test/workspace.js`.

| Thực thể | Trường chính |
|---|---|
| Collection | `name`, `description`, `children`, `vars`, `headers`, `auth`, `scripts {pre, post}`, `enabled` |
| Folder | `name`, `description`, `children`, `auth` (mặc định kế thừa), `enabled` |
| Request | `name`, `method`, `url`, `query[]`, `headers[]`, `body {mode, text}`, `auth`, `scripts`, `extract[]`, `enabled` |
| Environment | `name`, `color`, `isProd`, `vars[] {key, value, secret, enabled}`, `headers[]`, `allowHosts` |
| Preset | `name`, `collectionId`, `targets[]`, `envId`, `mode`, `concurrency`, `timeout`, `delay`, `priorities[]`, `stopOnCritical`, `retryErrors`, `useSessionVars` |

Test Suite JSON v1.0 (bên dưới) là **hợp đồng riêng**: workspace chỉ gắn một suite vào một request, không đổi cấu trúc suite.

### Lưu trữ (local-first)

| | Extension | Bản web |
|---|---|---|
| Dữ liệu bền | `chrome.storage.local` | `localStorage` |
| Secret + runtime variables | `chrome.storage.session` (mất khi đóng trình duyệt) | `sessionStorage` |

- Lưu **theo từng bản ghi** (`meta`, `n.<id>`, `e.<id>`, `p.<id>`, `s.<requestId>`, `run.last`), ghi trễ 300 ms; sửa một request chỉ ghi lại request đó. Thanh trên hiện *Đang lưu… / Đã lưu / Lưu thất bại* (có nút *Thử lại*). Bộ nhớ đầy → báo *Bộ nhớ đầy* kèm nút Export. Service: `store.js`.
- **Phục hồi:** bản ghi hỏng bị bỏ qua và báo một lần; request mất thư mục cha chuyển vào *Chưa lưu*; folder mất collection bị bỏ.
- **Kết quả gần nhất** (đã che) được lưu; quá ~2,5 MB thì rút gọn body (ghi rõ trong báo cáo).
- **Chuyển từ phiên bản trước:** lần đầu mở, dữ liệu cũ (`localStorage` `api-test-v2`: một request, một suite, scripts, DEV / STAGING / PROD) được chuyển thành collection *“Chuyển từ phiên bản trước”*. Bản cũ giữ nguyên; xoá được ở menu ⋮ → *Xoá dữ liệu phiên bản cũ*.

### Secret

`chrome.storage.local` không mã hoá, nên **giá trị bí mật không bao giờ ghi vào bộ nhớ bền**:

- biến đánh dấu secret (Environment, Collection, Globals);
- header / query có tên bí mật ghi thẳng giá trị (`Authorization: Bearer abc…`, `Cookie`, `X-API-Key`…);
- token / password / API key ghi thẳng trong tab Authorization.

Các giá trị này nằm ở session storage: đóng trình duyệt là mất, mở lại phải nhập lại (tool hỏi trước khi gửi / chạy). Nên dùng biến `{{TOKEN}}` và nhập giá trị ở Environment. Lưu secret bền có mã hoá bằng passphrase **chưa hỗ trợ** (cố ý hoãn, thay vì lưu chữ thường).

## Biến

`{{TEN}}` dùng được ở URL, params, headers, body, Authorization, request override của case.

**Thứ tự ưu tiên (cao → thấp):** `Runtime` › `Environment` › `Collection` › `Globals`.

- **Runtime:** biến đặt ra khi chạy: rule *Lưu biến từ response*, `extract` của case, `pm.environment.set / pm.variables.set` trong script. Không bao giờ tự ghi đè environment đã lưu.
  - *Send:* runtime của **phiên** (Environments → *Runtime (phiên)*: xem, *Lưu vào environment*, xoá).
  - *Runner:* bắt đầu **sạch** mỗi lần chạy (tuỳ chọn *Bắt đầu với Runtime variables của phiên*), truyền từ request trước sang request sau.
- Environment đặt trên Collection để đổi environment là đổi giá trị (giống Postman). Ô giá trị trống coi như chưa có.
- Biến sinh sẵn: `{{$timestamp}}`, `{{$isoTimestamp}}`, `{{$randomInt}}`, `{{$uuid}}`, `{{$guid}}`, `{{$randomUUID}}`, `{{$randomPhone}}`, `{{$randomEmail}}`.
- Dữ liệu lặp (iteration data / data-driven) **chưa hỗ trợ**.
- Thiếu giá trị: Send hiện *“Chưa có giá trị cho biến TOKEN”*, request chưa được gửi, kèm ô nhập và gợi ý request nào sinh ra biến đó. Runner chặn trước khi chạy (lỗi chặn có ô nhập ngay).

## Ghép request

Lớp header (lớp sau thắng, không phân biệt hoa thường; `null` ở case = xoá):

`Collection headers` → `Authorization` (bỏ qua nếu request đã tự ghi header cùng tên) → `Request headers` → `Environment headers` → `requestOverride.headers` của case

- **Authorization:** Kế thừa (đi ngược lên folder → collection), Không xác thực, Bearer, Basic, API Key (header hoặc query). Auth kế thừa mà biến của nó do **chính request này** tạo ra (vd request Login kế thừa `Bearer {{TOKEN}}` và tự lưu `TOKEN`) thì không gửi Authorization, có ghi cảnh báo. Digest / OAuth / AWS signature chưa hỗ trợ: dùng Pre-request script.
- **Body:** `none`, `JSON`, `Text`, `XML`, `x-www-form-urlencoded`. Content-Type tự thêm nếu chưa có. JSON có `{{biến}}` ngoài dấu nháy (`"id": {{ID}}`) được gửi nguyên văn sau khi thay biến. GET / HEAD bỏ body. **multipart/form-data (upload file) chưa hỗ trợ.**
- **Scripts:** script của collection chạy trước script của request (mỗi phần trong một block riêng).

## Send và Runner dùng chung một pipeline

`engine.js` (domain) → `runner.js` `ApiRunner.executor` → `transport.js`. Không có engine HTTP thứ hai. Mỗi lần gửi đi qua đúng thứ tự:

1. ghép request (biến, auth, headers, body);
2. **Pre-request script** (sandbox). Request script đã thấy / đã sửa được giữ nguyên, chỉ thay nốt `{{biến}}` còn lại: không ghép lại từ đầu, nên `{{$timestamp}}`, chữ ký HMAC… script tính ra vẫn khớp request gửi đi;
3. kiểm thiếu biến, Allowed hosts, quyền host của Chrome;
4. gửi;
5. chấm `statusCodes` + assertions + `maxTimeMs`, lưu biến (`extract`, rule của request);
6. **Post-response script** (mỗi `pm.test` thành một dòng kiểm tra);
7. che dữ liệu nhạy cảm (`seal`): kết quả chỉ giữ bản đã che.

**Send** không cần test case: PASS khi có response và mọi `pm.test` đạt. Response cho biết rõ khi request **chưa được gửi** (thiếu biến, host chưa được phép, chưa có quyền, script lỗi, body sai).

## Runner

**Phạm vi:** một request · mọi case của request · các folder / request được tích · cả collection · Preset. Mục đang **tắt** (menu → *Tắt khi chạy*) luôn bị bỏ qua. Request chưa có test case chạy một lần với **kỳ vọng mặc định HTTP 2xx** (báo cáo ghi rõ là mặc định).

**Phụ thuộc:** phân tích tĩnh biến request **dùng** (`{{X}}`, `pm.*.get('X')`) và biến request **sinh ra** (rule lưu biến, `extract`, `pm.*.set('X')`). Request dùng `X` chạy **sau** request sinh ra `X` trong cùng lần chạy (sắp xếp topo, giữ thứ tự cây khi không có ràng buộc). Vòng tròn → lỗi chặn. Khi chạy, request phụ thuộc mà biến vẫn chưa có (request trước không lấy được) → **ERROR “Request phụ thuộc chưa lấy được biến”**, request không được gửi.

**Kiểm tra trước khi chạy** (lỗi chặn có nút *Sửa*, cảnh báo không chặn):

- **Lỗi chặn:** thiếu biến; host ngoài Allowed hosts; chưa có quyền Chrome; script lỗi cú pháp; body JSON sai; phụ thuộc vòng tròn; không có case nào.
- **Cảnh báo:** PRODUCTION; request ghi dữ liệu; case `NEEDS_REVIEW` đang bật; case / script dùng biến chưa có; thứ tự đã được sắp xếp lại; request chưa có test case.

**Chế độ:**

- *Tuần tự* (mặc định).
- *Song song khi an toàn:* chỉ các case **trong một request** không truyền biến cho ai và không cần biến của ai mới chạy song song (tối đa 5). Mỗi case có bản sao biến riêng. Các request luôn chạy lần lượt.

**Dừng (Stop):**

- Case chưa chạy → `SKIPPED` (*“Đã dừng trước khi chạy tới case này”*).
- Case đang chạy bị huỷ → `SKIPPED` (*“Đã dừng khi request đang chạy… có thể đã tới máy chủ”*): không tính là lỗi của API.

**Thử lại:**

- Sau khi chạy: *Chạy lại FAIL*, *Chạy lại ERROR* (dùng biến runtime cuối của lần trước, chỉ giữ trong bộ nhớ), *Run lại*. Chạy lại request ghi dữ liệu phải xác nhận vì có thể tạo bản ghi trùng.
- Tự thử lại lỗi mạng / timeout (0–2 lần) chỉ cho GET / HEAD / OPTIONS.
- *Dừng sớm khi case P0 FAIL / ERROR* (tuỳ chọn).

**Xác nhận** khi environment là PRODUCTION hoặc có POST / PUT / PATCH / DELETE. Hộp xác nhận liệt kê environment, số request / case, request ghi dữ liệu, host đích; nút **Huỷ** được focus mặc định; không có request nào được gửi trước khi xác nhận.

**Preset** lưu phạm vi + environment + cách chạy (không lưu token). Dùng: *chọn Preset → Run*. Biến bí mật hết hạn / chưa nhập thì tool hỏi trước khi chạy.

## Test Suite JSON v1.0 / 1.1

Nguồn sự thật duy nhất là validator `extension/tools/api-test/schema.js`. Cùng một validator được dùng cho form sửa case, màn nhập (AI / Excel / JSON), runner; prompt AI lấy danh sách operator / type / body mode từ đó. Có thể tải file mẫu bằng nút **Tải JSON mẫu**.

```json
{
  "schemaVersion": "1.0",
  "suite": { "name": "User API", "description": "Kiểm thử tạo người dùng" },
  "cases": [
    {
      "id": "TC-001",
      "group": "Positive",
      "name": "Tạo người dùng hợp lệ",
      "description": "Body đầy đủ và đúng định dạng",
      "priority": "P1",
      "enabled": true,
      "requestOverride": {
        "body": { "mode": "json", "value": { "name": "Nguyen Van A", "email": "valid@example.test" } }
      },
      "expect": {
        "statusCodes": [200, 201],
        "assertions": [
          { "source": "body", "path": "$.data.id", "operator": "exists" },
          { "source": "body", "path": "$.success", "operator": "eq", "value": true }
        ]
      },
      "note": ""
    }
  ]
}
```

| Field | Quy tắc |
|---|---|
| `schemaVersion` | `"1.0"`, hoặc `"1.1"` khi có case dùng `expect.maxTimeMs` |
| `suite.name` | Bắt buộc, không rỗng. `description` tuỳ chọn |
| `cases` | 1 đến 1000 case |
| `id` | Chuỗi không rỗng, không trùng |
| `name` | Chuỗi không rỗng |
| `priority` | `P0` `P1` `P2` `P3` |
| `enabled` | `true` / `false`. `false` → SKIPPED |
| `group`, `description`, `note` | Chuỗi, tuỳ chọn. `note` bắt đầu bằng `NEEDS_REVIEW` nghĩa là case cần người kiểm tra trước khi bật |
| `requestOverride` | Tuỳ chọn: `method`, `url`, `queryParams`, `headers`, `body` |
| `expect.statusCodes` | Mảng mã 100–599, không rỗng |
| `expect.assertions` | Mảng, có thể rỗng |
| `expect.maxTimeMs` | **Chỉ 1.1.** Số nguyên 1–600000: thời gian phản hồi tối đa (ms) |
| `extract` | Tuỳ chọn: `{ "LEAD_ID": "$.data.id" }`: lưu biến runtime cho case / request sau |

Field lạ bị từ chối, lỗi chỉ rõ đường dẫn, vd `cases[2].expect.assertions[0].operator`. Tool chỉ ghi `"1.1"` khi suite thật sự dùng `maxTimeMs`; mọi suite 1.0 cũ vẫn nhập và chạy nguyên vẹn.

### requestOverride

- `method`: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS.
- `url`: link `http(s)://…` đầy đủ, template bắt đầu bằng biến (`{{baseUrl}}/users/1`), hoặc đường dẫn `/users/1` (nối vào origin của request). URL ghi đè có `?query` riêng thì thay query của request.
- `queryParams`, `headers`: object, ghép theo khoá; `null` = xoá khoá đó. Query nhận mảng giá trị để gửi lặp khoá.
- `body`: `{ "mode": "json" | "raw" | "form-urlencoded", "value": … }`, **thay thế toàn bộ** body của request. `raw`: chuỗi gửi nguyên văn (dùng cho case JSON sai cú pháp).

### Assertions

| Field | Quy tắc |
|---|---|
| `source` | `body` hoặc `header` |
| `path` | Với `body`: `$`, `$.field`, `$.a.b`, `$.items[0].id`. Với `header`: tên header, vd `content-type` |
| `operator` | `exists`, `notExists`, `eq`, `ne`, `contains`, `notContains`, `type`, `in`, `gt`, `gte`, `lt`, `lte` |
| `value` | Bắt buộc trừ `exists` / `notExists`. `type`: `string` `number` `boolean` `object` `array` `null`. `in`: mảng. `gt`…`lte`: số |

- `exists`: trường có mặt trong JSON (kể cả giá trị `null`). `notExists`: không có mặt.
- `eq` / `ne`: so sánh chặt cả kiểu (`1` khác `"1"`), object / mảng so sâu. Form chọn kiểu giá trị (Tự nhận / Chữ / Số / true-false / null / JSON) để tránh nhầm.
- `contains`: chuỗi chứa chuỗi (phân biệt hoa thường); mảng có phần tử bằng hoặc chứa object mong đợi; object chứa các cặp khoá–giá trị mong đợi.
- Không có biểu thức JavaScript nào được thực thi.

### Kết quả

| Trạng thái | Khi nào |
|---|---|
| PASS | Có response, HTTP status thuộc `statusCodes`, mọi assertion / `pm.test` đạt, không chậm hơn `maxTimeMs`. 4xx / 5xx vẫn PASS nếu đó là mong đợi |
| FAIL | Có response nhưng status, assertion, `pm.test` hoặc thời gian sai |
| ERROR | Không kiểm thử được. *Loại lỗi* ghi trong báo cáo: thiếu biến, request phụ thuộc chưa lấy được biến, bị chính sách bảo mật chặn, chưa có quyền Chrome, lỗi mạng / timeout, lỗi script, lỗi ghép request, lỗi khi chấm |
| SKIPPED | `enabled=false`, không được chọn / lọc, dừng sớm theo P0, hoặc tester bấm Stop |

Pass rate = PASS / (tổng − SKIPPED); chưa case nào chạy thì hiện `—`.

## Scripts: Pre-request và Post-response

Giống Postman, đặt ở **từng request** (tab Scripts) và ở **collection** (chạy trước script của request). Script không nằm trong file JSON test case, nên code do AI sinh ra không bao giờ được chạy.

| Thời điểm | Làm được gì |
|---|---|
| **Pre-request** | Đặt biến (`pm.environment.set`), sửa request (`pm.request.url`, `.method`, `.headers.upsert/remove`, `.body.raw`), gọi API phụ bằng `await pm.sendRequest(...)`, ký request bằng `crypto.subtle`. Lỗi → **ERROR**, request không được gửi |
| **Post-response** | `pm.test(tên, fn)` với `pm.expect(...)` / `pm.response.to.have.status(201)`; mỗi `pm.test` là một dòng kiểm tra (source `script`), sai → **FAIL**. Script lỗi khi chạy → **ERROR** (phân biệt rõ với assertion sai) |

- `pm.environment / pm.variables .set()` ghi vào biến **Runtime**, không ghi đè environment đã lưu.
- `pm.case` (`id`, `name`, `group`, `priority`, `note`); khi Send, `pm.case.id` là `SEND`.
- `require('crypto-js')` (hoặc `CryptoJS`): `HmacSHA256`, `HmacSHA1`, `HmacSHA512`, `HmacMD5`, `SHA256`, `SHA1`, `SHA512`, `MD5`, `enc.Hex` / `Base64` / `Utf8` / `Latin1`. Chưa có AES, SHA3.
- `console.log` ghi vào Console của response / evidence. ZIP có `scripts/<nn>-<request>/pre-request.js`, `post-response.js`.
- **Dry run** chạy riêng Pre-request script, không gửi request chính.

**Cách ly:** script chạy trong trang sandbox của extension (`tools/api-test/sandbox.html`, khai báo ở `manifest.json → sandbox`): origin riêng, không có API `chrome.*`, CSP `default-src 'none'` chặn mọi kết nối mạng, mỗi lần chạy một Worker riêng và bị dừng sau 15 giây. Cách duy nhất để gọi mạng là `pm.sendRequest`, do tool gửi hộ và vẫn bị chặn theo Allowed hosts. Bản web phục vụ trang sandbox với cùng CSP lấy từ `manifest.json`.

## Báo cáo

`qa-api-report-<run-id>.xlsx`:

- **Summary:** Run ID, preset, phạm vi, danh sách request, environment, thời gian, tổng PASS / FAIL / ERROR / SKIPPED, pass rate, chú giải.
- **Results:** mỗi case một dòng: Run ID, Collection, Folder, Request, TC ID, Group, Test Case, Priority, Method, URL (đã che), Expected / Actual Status, Status, Duration, Assertion Summary, **Error Type**, Error/Reason, Evidence ID, Note.
- **Evidence:** mỗi case một dòng, kể cả PASS: request, response, chi tiết từng kiểm tra, cảnh báo, console, lỗi kỹ thuật.

Ô dài hơn 30.000 ký tự được cắt kèm dòng `TRUNCATED: … Bản đầy đủ: evidence/<id>.json trong file ZIP`. **Export ZIP** gồm file Excel, `evidence/<evidence-id>.json` đầy đủ, `suites/<nn>-<request>.json` và scripts của từng request, `README.txt`. Ô bắt đầu bằng `=` `+` `-` `@` được đánh dấu là văn bản (chặn formula injection). Kết quả mở lại từ bộ nhớ máy vẫn export được.

## Import / Export workspace

Menu ⋮ → **Export workspace**: file `.json` (`"format": "qa-api-workspace"`, `"version": 1`) gồm collection, folder, request, test suite, scripts, environment (không kèm secret), Globals, preset. Tuỳ chọn *Kèm giá trị bí mật* (mặc định tắt, có cảnh báo).

**Import workspace:**

- Kiểm tra file và hiện xem trước (số collection / folder / request / test case / environment / preset), kèm các lưu ý.
- **Gộp** (mặc định): cấp id mới cho mọi thứ, không sửa / xoá dữ liệu đang có; environment trùng tên thêm hậu tố “(nhập)”.
- **Thay thế toàn bộ:** phải xác nhận, có nút tải bản sao lưu trước.
- Tham chiếu hỏng được sửa và báo lại: request trỏ tới folder không có → *Chưa lưu*; preset trỏ tới mục đã mất → bỏ mục đó.
- File Test Suite JSON đưa nhầm vào đây được nhận ra và hướng dẫn nhập ở tab Tests.

## Bảo mật

- **Che dữ liệu nhạy cảm** ở giao diện, kết quả đã lưu, Excel, ZIP:
  - header `Authorization`, `Cookie`, `Set-Cookie`, `X-API-Key`…;
  - query / khoá JSON có tên như `password`, `token`, `secret`, `api_key`, `session`, `otp`, `signature`;
  - mọi chỗ xuất hiện giá trị của biến secret, token / password ghi thẳng trong Authorization, giá trị biến có tên bí mật do script / extract tạo ra trong lúc chạy.
- **Host được phép (Allowed hosts)** theo environment + Globals: request tới host ngoài danh sách bị chặn (không gửi). localhost / IP nội bộ phải ghi đúng tên, không qua `*`. IP metadata cloud (`169.254.169.254`…) luôn bị chặn.
- **Extension:**
  - Một luật `declarativeNetRequest` chặn mọi request do extension gửi tới domain ngoài Allowed hosts, nên trình duyệt **không đi theo redirect sang host lạ**.
  - URL cuối được kiểm lại; sai → ERROR, bỏ response (fail closed).
  - Không đặt được luật → `redirect: 'manual'`, gặp redirect là dừng.
  - Luật được gỡ sau mỗi lần Send / Run.
  - Quyền host của Chrome (`chrome.permissions`) được kiểm trước khi gửi; tool không tự xin quyền, tester bấm *Cấp quyền*.
  - Header Cookie / Origin / Referer / User-Agent gắn qua DNR; request cần bộ luật khác nhau không chạy chồng lên nhau.
- **Bản web (`/api/proxy`):**
  - Kiểm allowlist.
  - Kiểm **IP thật lúc kết nối** (hàm `lookup` của `http` / `https`), không còn khoảng hở tra DNS rồi kết nối lại, nên chặn được DNS rebinding.
  - Đi redirect từng bước (tối đa 5) và kiểm lại mỗi bước.
  - Body gửi tối đa 20 MB, response đọc tối đa 10 MB (sau giải nén gzip / deflate / br).
  - Proxy chỉ nhận request cùng origin.
- **cURL** chỉ được tách chữ theo quy tắc của bash / cmd, không bao giờ thực thi. `-k/--insecure` bị bỏ qua: không tắt kiểm tra TLS.
- **Request ghi dữ liệu:** Send lên PRODUCTION với POST / PUT / PATCH / DELETE, mọi lần Run trên PRODUCTION hoặc có request ghi dữ liệu đều phải xác nhận. Không tự thử lại request ghi dữ liệu.

## Giới hạn hiện tại

- **Upload và mã hoá:** chưa hỗ trợ multipart / upload file (`-F`, form-data của Postman). Chưa lưu secret bền có mã hoá (passphrase).
- **Dữ liệu và chạy:** chưa có dữ liệu lặp (iteration / CSV data-driven).
- **Lịch sử:** chỉ lưu kết quả của lần chạy gần nhất.
- **Đồng bộ:** mở tool ở hai tab cùng lúc thì bản ghi lưu sau thắng (không đồng bộ giữa tab). Extension và bản web không dùng chung dữ liệu.
- **Che dữ liệu:** dựa vào tên (header, khoá JSON, biến) và giá trị đã biết. Token nằm trong field có tên không giống bí mật và không được lưu vào biến bí mật thì vẫn hiện trong evidence.
- **Luật chặn redirect của extension:** áp cho mọi request do extension gửi trong lúc tool đang Send / Run, kể cả nút *Kiểm tra cập nhật* của hub (thử lại sau khi chạy xong). Luật DNR khớp theo domain (gồm subdomain, không xét cổng); ApiPolicy kiểm lại URL cuối đủ luật. Allowed hosts dạng IPv6 làm extension dừng ở mọi redirect.
- **Response:** response nhị phân chỉ ghi content-type, kích thước và 64 byte đầu (hex).

# Kiểm thử API: context UI/UX

Mô tả giao diện hiện tại của công cụ **Kiểm thử API** (qa-toolkit), dùng làm bối cảnh khi review UX hoặc sửa giao diện. Contract dữ liệu và logic chạy xem [api-test.md](api-test.md).

## 1. Sản phẩm và người dùng

- **Nguyên tắc:** cấu hình một lần, dùng lại mọi nơi, chạy lại với ít thao tác nhất.
- **Hành trình chính:** dán cURL → Send → lưu vào collection → thêm test case (form / Excel / AI) → Runner (hoặc Preset) → xem evidence → Export.
- **Người dùng:** tester / QA người Việt, quen Postman và Excel, nhiều người không viết code.
- **Rủi ro UI phải chặn:** gửi nhầm request ghi dữ liệu lên production, lộ token trong báo cáo, gọi nhầm hệ thống khác, chạy request phụ thuộc trước khi có token / id.

## 2. Ràng buộc kỹ thuật

- Chrome extension MV3, HTML / CSS / JS thuần, không framework, không CDN, không script inline. Chạy trong iframe của hub (tên tool trên thanh ứng dụng tự ẩn), trong tab riêng (menu ⋮ → *Mở trong tab riêng*) hoặc bản web.
- Chỉ dùng design token của `extension/shared/theme.css`; hỗ trợ sáng / tối / màu chủ đạo tự chọn.
- Bố cục cao đúng 100% khung nhìn; vùng chính cuộn riêng. Responsive bằng **container query** `main` (chiều rộng thật của vùng chính) và `drawer`; sidebar thành ngăn trượt khi màn hình ≤ 760px.

## 3. Information architecture

```
┌ Thanh ứng dụng ──────────────────────────────────────────────────────────────────────┐
│ ☰  Kiểm thử API  [Requests | Environments | Runner]      Đã lưu   ● DEV ▾    ⋮         │
├──────────────┬───────────────────────────────────────────────────────────────────────┤
│ 🔍 Tìm…   ＋  │ Vùng chính: Request · Collection/Folder · Environments · Runner · Màn chào │
│ CHƯA LƯU     │                                                                       │
│  GET  …      │                                                                       │
│ ▾ Student API│                                                                       │
│   ▾ Auth     │                                                                       │
│     POST Login                                                                       │
│ [Dán cURL]   │                                                                       │
└──────────────┴───────────────────────────────────────────────────────────────────────┘
  Drawer (phải): Sửa test case · Nhập test case (AI / Excel / JSON) · Evidence
  Hộp thoại: dán cURL (có bước xem lại) · xác nhận · nhập tên · chọn đích · import / export workspace
```

| Khu vực | Nội dung chính | Nâng cao (ẩn mặc định) |
|---|---|---|
| **Sidebar** | Cây Collection › Folder › Request, mục *Chưa lưu*, tìm kiếm, nút ＋ | Menu ngữ cảnh: di chuyển, nhân bản, bật / tắt khi chạy, sắp xếp |
| **Request** | Tên, method, URL, **Send**, xem trước URL thật; tab Params · Authorization · Headers · Body · Scripts · Tests; Response bên dưới (kéo đổi chiều cao) | Scripts, request override của case, Console |
| **Collection / Folder** | Tổng quan (mô tả, danh sách con, Run), Variables, Authorization, Headers, Scripts (collection) | — |
| **Environments** | Danh sách environment + Globals + Runtime (phiên); sửa biến, Allowed hosts, header, màu, cờ Production | — |
| **Runner** | Preset · Chạy gì (cây tích) · Cách chạy · Kiểm tra trước khi chạy · Kết quả | Timeout, song song, nghỉ, lọc priority, dừng sớm P0, tự thử lại, dùng runtime phiên |

## 4. Từng khu vực

### Thanh ứng dụng
- 3 tab khu vực (`tablist`, ← → để chuyển). Chấm trên tab Runner khi có kết quả.
- Trạng thái lưu: *Đang lưu…* (icon xoay) · *Đã lưu* · *Lưu thất bại* + *Thử lại* · *Bộ nhớ đầy* (toast có nút Export).
- Chọn environment: chấm màu theo environment, viền / nền đỏ khi Production; có mục *Không dùng environment* và *Quản lý environments…*.
- Menu ⋮: Export / Import workspace, Mở trong tab riêng, Dung lượng đã dùng, Xoá dữ liệu phiên bản cũ (khi còn).

### Sidebar
- Cây phẳng có `aria-level` (role `tree` / `treeitem`), roving tabindex.
  - ↑ ↓ Home End: di chuyển; → ←: mở / gập hoặc vào con / về cha; Enter: mở.
  - F2: đổi tên; Delete: xoá; Shift+F10 / phím Menu: menu ngữ cảnh; Alt+↑ ↓: sắp xếp.
- Request: nhãn method màu, số test case; mục tắt khi chạy gạch ngang + icon `block`.
- Tìm kiếm (Ctrl / ⌘ + K) theo tên, method, URL; giữ nhánh cha để thấy vị trí; tô đậm chỗ khớp.
- Trạng thái trống: *Chưa có collection* (Tạo collection / Dán cURL) · *Không tìm thấy “…”* (Xoá tìm kiếm).
- Kéo cạnh phải để đổi độ rộng (← → khi focus), nút ☰ để ẩn / hiện.

### Màn chào (chưa có gì / chưa chọn request)
- “Bắt đầu kiểm thử API” với 3 hành động: **Dán cURL / Fetch** (chính) · Tạo request · Import workspace. Không bắt tạo collection hay environment trước.

### Dán cURL / Fetch (hộp thoại)
- Dán là tự đọc; lỗi đọc hiện ngay dưới ô.
- **Bước xem lại** liệt kê mọi thay đổi tool đề xuất, mỗi mục một ô tích:
  - tắt header của trình duyệt;
  - chuyển token / cookie / API key thành biến bí mật `{{TOKEN}}`;
  - tách base URL `https://… → {{baseUrl}}`;
  - cho phép host (thêm vào Allowed hosts).
- Có ô đặt tên request và chọn nơi lưu (*Chưa lưu* hoặc collection / folder).
- Hai nút: *Tạo request* / *Tạo & Send*.

### Request
- Tiêu đề sửa tại chỗ; badge *Chưa lưu vào collection* + nút **Lưu vào collection**; nút *Run tests*; menu ⋯.
- Thanh URL: method (màu) · URL · **Send** (Ctrl + Enter; khi đang gửi thành **Huỷ**). Dán URL có `?query` → tự chuyển sang tab Params.
- Dòng dưới URL: URL thật sau khi thay biến (đã che secret), hoặc *Chưa có giá trị cho {{baseUrl}}* + *Nhập giá trị*, hoặc *host chưa được phép* + *Cho phép*.
- Các tab:
  - **Authorization:** Kế thừa (ghi rõ đang dùng của folder / collection nào) / Không / Bearer / Basic / API Key.
  - **Body:** `none · JSON · Text · XML · x-www-form-urlencoded`, nút Format, báo JSON hợp lệ.
  - **Scripts:** Pre-request / Post-response, số dòng, kiểm cú pháp, Dry run, Snippets, API reference.
  - **Tests:** *Lưu biến từ response* + danh sách test case.
- **Response:**
  - *Chưa gửi* (trống) · *Đang gửi…*.
  - Có response: status màu, thời gian, kích thước, redirect, số `pm.test` đạt / sai, biến vừa lưu. Tab Body (Pretty / Raw, tìm trong body, Copy; **bấm tên field để lưu thành biến**) · Headers · Tests · Console (cảnh báo, request đã gửi, log).
  - **Chưa gửi được:** nêu rõ *Request chưa được gửi* và lý do, kèm hành động: Nhập giá trị / Cho phép host / Cấp quyền / Mở Body / Mở Scripts. Thiếu biến do request khác sinh ra thì có link mở request đó.

### Tab Tests
- **Lưu biến từ response:** bảng `Tên biến ← Body (JSON) / Header / Status code + đường dẫn`, kiểm cú pháp path ngay khi gõ.
- **Chưa có test case:** giải thích Runner sẽ dùng kiểm tra mặc định 2xx; 4 thẻ: Thêm thủ công · Excel → JSON bằng AI · Upload Excel · Import JSON.
- **Có test case:**
  - thống kê bấm được để lọc (Tổng · Sẽ chạy · Cần review · Đang tắt);
  - thông báo `NEEDS_REVIEW`;
  - tìm kiếm + lọc priority;
  - thanh hàng loạt (Bật / Tắt / Xoá / Bỏ chọn);
  - bảng phân trang 25 / 50 / 100;
  - menu: đổi tên bộ, tải JSON, Run, xoá toàn bộ (có hoàn tác).

### Test Case Builder (drawer)
- **Form:**
  - TC ID, Priority, Bật, Tên, Group (gợi ý group đã có), Mô tả.
  - **Kết quả mong đợi:** HTTP status (gõ hoặc bấm chip 200 / 201 / 2xx / 4xx…), thời gian phản hồi tối đa.
  - **Kiểm tra response** theo từng dòng `Nguồn · Trường · Phép so · Giá trị`:
    - phép so ghi bằng chữ: tồn tại, bằng, chứa, có kiểu, thuộc danh sách, lớn hơn…;
    - ô giá trị đổi theo phép so (chọn kiểu, nhập danh sách, ô số), có chọn *kiểu giá trị* để phân biệt `123` với `"123"`;
    - dòng tóm tắt bằng chữ ngay dưới;
    - ô Trường gợi ý đường dẫn từ response gần nhất.
  - **Lưu biến cho case sau.**
  - **Nâng cao:** ghi đè request (method, URL, query, header, body).
  - Ghi chú.
- **Raw JSON** cho người dùng nâng cao. Lưu → kiểm tra cả suite bằng validator, lỗi hiện bằng nhãn dễ đọc (*Kiểm tra 2 › Trường*).

### Nhập test case (drawer)
- Tab: **Excel → JSON bằng AI** (Copy prompt → gửi AI → dán / upload JSON) · **Upload Excel** (kéo thả, sheet, dòng tiêu đề, column mapping tự nhận, xem trước 5 dòng) · **Import JSON** (+ tải JSON mẫu).
- **Kết quả kiểm tra:** Tổng · Hợp lệ · Cần review · Lỗi, kèm:
  - danh sách lỗi theo đường dẫn, mỗi lỗi có nút **Sửa case** (mở Test Case Builder trên bản nháp, lưu xong quay lại);
  - danh sách case `NEEDS_REVIEW`.
- Chân drawer: *Thay toàn bộ* / *Thêm vào cuối* (khi request đã có case) + **Lưu vào request** (có hoàn tác).

### Collection / Folder
- Tiêu đề sửa tại chỗ, số folder / request / test case, **Run collection / folder**.
- Tab Tổng quan (mô tả, danh sách con bấm để mở, thêm Request / Từ cURL / Folder; trạng thái trống có hành động), Variables, Authorization, Headers, Scripts (kiểm cú pháp).

### Environments
- **Trái:** danh sách environment (màu, số biến, số host, *Đang dùng*, *PROD*), **Globals**, **Runtime (phiên)**.
- **Phải:**
  - tên sửa tại chỗ, *Dùng environment này*, Nhân bản, Xoá (có hoàn tác);
  - màu nhận diện (radiogroup), cờ Production;
  - **Request đang dùng biến chưa có giá trị ở đây** (nút Thêm);
  - Variables (khoá secret, nút mắt);
  - Allowed hosts (ô thẻ);
  - Headers của environment.
- **Runtime:** bảng biến (secret hiện `****`), *Lưu vào environment*, xoá từng biến / tất cả.

### Runner
- **Preset:** mỗi preset một dòng (tên, collection, số mục, environment) + **Run** ngay + menu (đổi tên, nhân bản, ghi cấu hình hiện tại, xoá). Cấu hình khác preset → *Lưu thay đổi vào preset*.
- **Chạy gì:** chọn collection + cây tích folder / request (tích folder là gồm cả con; không tích = cả collection).
- **Cách chạy:** environment, chế độ (Tuần tự / Song song khi an toàn), nâng cao.
- **Kiểm tra trước khi chạy** (cạnh phải, sticky):
  - lưới tóm tắt (Environment, Phạm vi, Request, Test case, Ghi dữ liệu, Host; PROD tô đỏ);
  - *Thứ tự chạy* (sau request nào, sinh biến gì);
  - **ô nhập ngay** biến còn thiếu;
  - lỗi chặn (đỏ, có nút sửa) / cảnh báo (vàng) / thông tin (xanh);
  - nút lớn **Run N case**.
- **Xác nhận** (alertdialog, Huỷ được focus): environment, số request / case, danh sách request ghi dữ liệu, host đích.
- **Kết quả:**
  - Thẻ tiến độ: đang chạy request nào, %, **Stop**.
  - Chạy xong: *Chạy lại FAIL* / *Chạy lại ERROR* / *Run lại* / Export Excel / Export ZIP / Xoá.
  - 6 KPI (PASS, FAIL, ERROR, SKIPPED bấm để lọc · Pass rate · Thời gian chạy theo thời gian thực).
  - Chip lọc trạng thái, lọc Folder, lọc Request, tìm kiếm.
  - Bảng **gom theo request** (dòng tiêu đề có method, tên, folder, số PASS / FAIL…); dòng FAIL / ERROR có vạch màu, cột lý do có nhãn loại lỗi. Chạy xong mà có lỗi → tự lọc FAIL + ERROR.
  - Kết quả lần trước được mở lại khi vào tool (ghi rõ thời điểm).

### Evidence (drawer)
- Tiêu đề TC ID + badge. Lưới: Request (method, tên, collection / folder), Expected → Actual, thời gian, Evidence ID.
- Hộp lý do có **loại lỗi** và câu giải thích: thiếu biến, phụ thuộc, chính sách, quyền, mạng, script, đã dừng…
- Tab:
  - **Kiểm tra:** dòng sai lên đầu, nền đỏ.
  - **Request:** Copy cURL đã che.
  - **Response:** body, headers thu gọn, Copy body.
  - **Console:** cảnh báo, lỗi kỹ thuật, log, biến đã lưu.
- ‹ › (Alt + ← →) chuyển case trong danh sách đang lọc.

### Hướng dẫn trong giao diện (`help.js`)
- **Drawer Hướng dẫn:** nút **?** trên thanh ứng dụng, phím `?` hoặc `F1`. Mục lục bên trái và ô tìm kiếm (tô sáng chỗ khớp). 12 chủ đề: Bắt đầu trong 3 phút, Tạo & gửi request, Biến & Environment, Lấy token cho request sau, Test case, Nhập từ Excel / AI, Runner & Preset, Đọc kết quả, Scripts, Lưu trữ & bảo mật, Lỗi thường gặp, Phím tắt.
- **Checklist “Bắt đầu nhanh” (7 bước):** tạo request → Send → lưu vào collection → cấu hình environment → thêm test case → chạy Runner → lưu Preset. Tính từ dữ liệu thật, mỗi bước chưa xong có nút làm ngay. Checklist hiện ở 3 chỗ:
  - màn chào;
  - chủ đề *Bắt đầu*;
  - nút **Bắt đầu x/7** trên thanh ứng dụng (ẩn được, tự ẩn khi xong).
- **Nút ? theo ngữ cảnh** (`data-help="chủ-đề"`): request, Scripts, Tests (lưu biến / test case), Test Case Builder, drawer nhập case, Environments, Runner, chú giải kết quả.
- **Mẹo** ở Environments, Collection, Tests, Runner: ẩn từng mẹo được (ghi nhớ), toast có *Hiện lại mọi mẹo*.
- **Sau khi Send:** thanh *Tiếp theo* (Lưu vào collection · Thêm test case · Lưu field thành biến · Run tests), ẩn được. Response trống có 3 bước hướng dẫn.
- **File Excel mẫu** (`qa-api-testcase-mau.xlsx`, có sheet *Hướng dẫn* cách ghi Expected) tải được từ: tab Tests khi chưa có case, tab Upload Excel, chủ đề Excel.
- Chú giải PASS / FAIL / ERROR / SKIPPED ngay dưới KPI của Runner.

## 5. Ngôn ngữ và trạng thái

- Câu tiếng Việt, **thuật ngữ giữ tiếng Anh** khi tester đã quen từ Postman: Request, Collection, Folder, Params, Headers, Body, Authorization, Environment, Variables, Globals, Runtime, secret, Allowed hosts, Scripts, Pre-request, Post-response, Send, Run, Runner, Preset, Test case, Expected, Actual, Evidence, Console, PASS / FAIL / ERROR / SKIPPED.
- Lỗi ở giao diện chính viết thành câu hành động (*“Chưa có giá trị cho biến TOKEN”* + cách xử lý + nút), chi tiết kỹ thuật để ở Console / *Chi tiết kỹ thuật*.
- Trạng thái luôn có chữ + icon: PASS `check_circle` xanh, FAIL `cancel` đỏ, ERROR `error` vàng, SKIPPED `skip_next` xám, đang chạy icon xoay. Environment theo màu tester chọn; Production viền / nền đỏ.
- Phản hồi: toast (tạo / lưu / xoá có *Hoàn tác*, Send lưu biến runtime có *Xem*, export, đổi environment), lỗi inline cạnh chỗ nhập.
- Trạng thái đã thiết kế: trống, đang tải, đang gửi, đang lưu / đã lưu / lưu lỗi / bộ nhớ đầy, đang chạy, đang dừng, xong, chưa gửi được (thiếu biến / host / quyền / script), import không hợp lệ, case cần review.

## 6. Trợ năng

- Thanh khu vực, tab request, tab response là `tablist`; body type, màu environment là `radiogroup` có phím mũi tên.
- Cây Collection: `tree` đầy đủ phím (mục 4).
- Menu ngữ cảnh `menu` / `menuitem`: ↑ ↓ Home End, Esc đóng và trả focus.
- Drawer / hộp thoại: `role="dialog"` / `alertdialog`, giữ focus bên trong, Esc đóng, trả focus về nơi mở.
- Dòng bảng focus được; Enter mở; ↑ ↓ di chuyển. Toast có `aria-live`. Thanh kéo đổi kích thước là `separator` dùng được bằng phím mũi tên.
- Trình soạn script: Tab thụt lề, Esc rồi Tab để rời ô.

## 7. Responsive (theo chiều rộng vùng chính)

- **≤ 1100px:** Runner 1 cột (kiểm tra trước khi chạy xuống dưới); KPI 3 cột.
- **≤ 860px:** Environments 1 cột (danh sách thành lưới thẻ); màn chào 1 cột.
- **≤ 640px:**
  - thanh URL xuống dòng (URL chiếm cả hàng);
  - form 1 cột;
  - **bảng test case và kết quả thành thẻ**;
  - KPI 2 cột.
- **Màn hình ≤ 760px:** sidebar thành ngăn trượt (nút ☰, nền mờ), tab khu vực chỉ còn icon. **≤ 640px:** drawer chiếm toàn màn hình.

## 8. Còn hạn chế

- Bảng dùng phân trang, chưa ảo hoá cuộn.
- Trình soạn script / body là textarea (không tô màu cú pháp). JSON viewer chỉ dùng cho response ≤ 400 KB (lớn hơn hiện dạng chữ).
- Chưa kéo-thả trong cây: di chuyển bằng menu *Di chuyển tới…*, sắp xếp bằng Alt + ↑ ↓ hoặc menu.
- Chưa có lịch sử nhiều lần chạy / so sánh hai lần chạy.
- Request override dạng mảng query (`a=[1,2]`) khi sửa bằng form sẽ thành chuỗi "1,2"; dùng Raw JSON nếu cần mảng.

## 9. File liên quan

| File | Vai trò |
|---|---|
| `index.html` | khung, drawer |
| `style.css` | giao diện |
| `ui.js` | toast, hộp thoại, drawer, menu, bảng key/value, JSON viewer |
| `app.js` | khởi động, sidebar, Environments, Collection / Folder, import / export |
| `app-request.js` | request, Send, response, dán cURL |
| `app-tests.js` | tab Tests, Test Case Builder, nhập test case |
| `app-run.js` | Runner, preset, kết quả, evidence |
| `help.js` | hướng dẫn, checklist bắt đầu nhanh, mẹo, gợi ý bước tiếp theo, file Excel mẫu |

Domain / service: `workspace.js`, `engine.js`, `runner.js`, `schema.js`, `store.js`, `transport.js`, `report.js`. Dùng chung: `extension/shared/theme.css` / `theme.js`, `extension/hub.*`.

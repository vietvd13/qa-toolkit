# Nhật ký thay đổi

Ghi theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/), đánh số theo [Semantic Versioning](https://semver.org/lang/vi/).

## [Chưa phát hành]

## [1.4.0] - 2026-10-26

### Thêm
- Công cụ **Kiểm thử API**: client API kiểu Postman tối giản cho QA kèm test runner tự động (`docs/api-test.md`, `docs/api-test-ux.md`):
  - **Workspace trên máy** (không tài khoản, không máy chủ): Collection › Folder lồng nhau › Request, mục *Chưa lưu*. Tạo / đổi tên / nhân bản / di chuyển / sắp xếp / tắt khi chạy / xoá có hoàn tác. Tìm kiếm, menu ngữ cảnh, cây dùng được bằng bàn phím. Tự lưu theo từng bản ghi (`chrome.storage.local`, bản web dùng `localStorage`), báo *Đang lưu / Đã lưu / Lưu thất bại / Bộ nhớ đầy*, tự sửa dữ liệu hỏng một phần.
  - **Request + Send**: method, URL (tự tách query), Params, Authorization (kế thừa / Bearer / Basic / API Key), Headers, Body (JSON / Text / XML / x-www-form-urlencoded), Scripts. Xem trước URL thật sau khi thay biến. Response: status, thời gian, kích thước, redirect, Pretty / Raw, tìm trong body, headers, `pm.test`, console. Báo rõ khi request **chưa được gửi** kèm nút xử lý.
  - **Dán cURL / Copy as fetch** (bash, cmd của Windows): đọc an toàn, không thực thi. Có bước **xem lại** trước khi áp dụng thay đổi: tắt header trình duyệt, chuyển token thành biến bí mật, tách `{{baseUrl}}`, cho phép host.
  - **Environment không giới hạn** (mặc định DEV / STAGING / PROD): tạo, nhân bản, đổi tên, màu, cờ Production, biến secret, header chung, Allowed hosts. Có **Globals** và **Runtime** của phiên. Thứ tự ưu tiên Runtime › Environment › Collection › Globals; script không ghi đè environment đã lưu.
  - **Secret chỉ giữ trong phiên** (`chrome.storage.session`): biến secret, token / password ghi thẳng không bao giờ ghi vào bộ nhớ bền, không vào file export (trừ khi chủ động chọn).
  - **Lưu biến từ response** (bấm field trong JSON → `{{TOKEN}}`) và **phụ thuộc giữa request**: Runner tự chạy request sinh biến trước request dùng biến. Request phụ thuộc thiếu biến thì không gửi (ERROR rõ lý do).
  - **Test case không cần code**: form (HTTP status, kiểm tra field / kiểu / giá trị / danh sách / so sánh số, thời gian phản hồi tối đa, lưu biến, ghi đè request) hoặc Raw JSON. Nhập từ **Excel → JSON bằng AI**, **Upload Excel** (map cột, xem trước) hoặc **Import JSON**, kèm tổng hợp hợp lệ / cần review / lỗi và nút sửa case lỗi. Case chưa rõ Expected → tắt + `NEEDS_REVIEW`.
  - **Test Suite JSON 1.1**: thêm `expect.maxTimeMs` (tuỳ chọn). Suite 1.0 dùng nguyên vẹn; `schema.js` vẫn là nguồn sự thật duy nhất.
  - **Runner**: chạy một request, folder, các mục được tích, cả collection hoặc **Preset**. Kiểm tra trước khi chạy (thiếu biến nhập ngay, host, quyền Chrome, script lỗi cú pháp, phụ thuộc vòng tròn). Tuần tự hoặc song song khi chứng minh được an toàn. Dừng sớm khi P0 sai, tự thử lại lỗi mạng cho GET. Stop có kết quả rõ ràng (SKIPPED, không tính là lỗi API). *Chạy lại FAIL / ERROR* có cảnh báo dữ liệu trùng. Xác nhận khi PRODUCTION hoặc có POST / PUT / PATCH / DELETE (nút Huỷ focus mặc định).
  - **Run Preset**: lưu phạm vi + environment + cách chạy, *chọn Preset → Run*.
  - **Kết quả**: KPI, pass rate, lọc theo trạng thái / folder / request / chữ, bảng gom theo request. Evidence drawer phân loại lỗi (thiếu biến, phụ thuộc, chính sách, quyền, mạng, script, đã dừng). Lần chạy gần nhất được lưu (đã che).
  - **Export Excel** Summary / Results / Evidence (thêm Collection, Folder, Request, Error Type; ô dài ghi `TRUNCATED`, chặn formula injection) và **Export ZIP** (evidence JSON đầy đủ, suite + scripts từng request). Token, cookie, Authorization, API key, mật khẩu được che trong giao diện, kết quả đã lưu và mọi file xuất.
  - **Import / Export workspace** (JSON có phiên bản): xem trước, gộp (id mới, không đè) hoặc thay thế (phải xác nhận, có sao lưu). Tự chuyển dữ liệu của bản thử nghiệm trước sang workspace.
  - **Scripts** Pre-request / Post-response giống Postman ở request và collection, chạy trong trang sandbox không có mạng (`pm.sendRequest` đi qua tool, vẫn bị chặn theo Allowed hosts). Request do Pre-request script sửa được giữ nguyên khi gửi, không sinh lại `{{$timestamp}}` / dữ liệu ngẫu nhiên.
  - **Hướng dẫn ngay trong giao diện:**
    - drawer Hướng dẫn (phím `?`), 12 chủ đề có tìm kiếm;
    - checklist **Bắt đầu nhanh** 7 bước theo tiến độ thật;
    - nút **?** cạnh từng khu vực, mẹo ẩn được, gợi ý *Tiếp theo* sau khi Send;
    - tải **file Excel mẫu** kèm cách ghi Expected.
  - **Bảo mật gửi request**:
    - Extension: chặn redirect sang host ngoài Allowed hosts ngay ở tầng mạng (luật `declarativeNetRequest`) và bỏ response nếu URL cuối không hợp lệ (fail closed). Kiểm quyền host của Chrome trước khi gửi.
    - Bản web: `/api/proxy` kiểm IP **lúc kết nối** (chặn DNS rebinding), kiểm từng bước redirect, giới hạn kích thước, giải nén gzip / br.
- Tự kiểm tra bản mới trên GitHub Releases: đầu trang hiện nút **Bản mới**, bảng **Cập nhật** có ghi chú thay đổi, nút tải .zip và tải lại extension; nút **Kiểm tra cập nhật** ở cuối thanh bên.
- Link **Mã nguồn trên GitHub** ở thanh bên; link repo trong `manifest.json` (homepage_url) và `package.json`.

### Thay đổi
- Icon và logo mới cho extension, đầu trang bộ công cụ và README (có bản logo cho nền tối).
- Bỏ kiểm tra tự động lời nhắn commit (commitlint ở husky và trên CI). Conventional Commits chỉ còn là quy ước khuyến khích.
- Kiểm thử API:
  - tô màu `{{biến}}` ngay trong ô nhập theo trạng thái (có giá trị / chưa có / sẽ có khi chạy / biến sinh sẵn);
  - Export Excel / ZIP theo bộ lọc đang dùng;
  - ô Token gọn và rõ hơn, kèm trạng thái biến;
  - chữ tiếng Việt không còn dùng font mono, cỡ chữ lớn hơn;
  - vùng Response thu gọn khi chưa có response; Runner đưa nút Run lên đầu khi màn hẹp.

## [1.3.0] - 2026-10-11

### Thêm
- Đầu trang mới: tìm công cụ (Ctrl K hoặc /), nút chuyển nhanh Theo hệ thống / Sáng / Tối, nút mở Giao diện.
- Trang **Tất cả công cụ** có đếm số và lọc theo nhóm; thanh bên có nhóm "Công cụ" thu gọn được.
- Trường `category` và `platforms` trong `tools/registry.js`.
- Thang chữ, khoảng cách (bội số 4px) và bo góc dùng chung trong `shared/theme.css`.
- Quy tắc commit theo Conventional Commits, kiểm tra tự động bằng commitlint + husky và trên CI.

### Thay đổi
- Font Inter cho toàn bộ giao diện, mono của hệ điều hành cho link và mã.
- Bản web (`npm run ui`) dùng nguyên khung bộ công cụ, giao diện giống hệt extension.
- Tên gói `qa-toolkit`, tác giả [vietvd13](https://github.com/vietvd13).

### Sửa
- Đổi sáng/tối không còn thoáng thấy nền cũ với chữ mới trên thẻ công cụ.

## [1.2.0] - 2026-10-11

### Thêm
- Hệ màu *Feminine Work OS* (màu gốc → vai trò → thành phần) cho mọi công cụ.
- Chế độ màu Theo hệ thống / Sáng / Tối, tự đổi khi hệ điều hành đổi.
- Bảng **Giao diện**: chọn màu chủ đạo, màu phụ (có sẵn hoặc tự chọn), xem trước, kiểm tra độ dễ đọc.
- Tự chỉnh màu quá nhạt để chữ đạt tương phản 4.5:1.

### Thay đổi
- Chữ và nút chính trong giao diện sáng dùng rose-600 `#AD4168` (rose-500 chỉ đạt 4.26:1 với chữ trắng).
- Nút "Dừng" dùng kiểu nút nguy hiểm (nền đỏ).

## [1.1.0] - 2026-10-11

### Thêm
- Khung **Bộ công cụ**: thanh bên, trang chọn công cụ, công cụ chạy song song không mất kết quả.
- Giao diện dùng chung `shared/theme.css` và khung mẫu `tools/_template` để tạo công cụ mới.
- Lệnh `npm run ext:zip` đóng gói extension.

### Thay đổi
- Bản web (`npm run ui`) dùng chung giao diện với extension.

## [1.0.0] - 2026-10-11

### Thêm
- Chrome extension **Kiểm tra Redirect**: ghi lại mọi bước chuyển hướng (302, JavaScript, meta refresh, mở app) bằng `webRequest`/`webNavigation`.
- Tìm `sub3`, `sub4`, `Sub_id`, `affiliate_id`, `utm_content` ở từng link, kể cả link lồng đã mã hoá.
- Tổng quan, tỉ lệ từng giá trị, nhóm kết quả, nhận xét tự động, xem bằng chứng, xuất CSV.
- Bản dòng lệnh và bản web chạy bằng Playwright; script dán vào Console.

[Chưa phát hành]: ../../compare/v1.4.0...HEAD
[1.4.0]: ../../releases/tag/v1.4.0
[1.3.0]: ../../releases/tag/v1.3.0
[1.2.0]: ../../releases/tag/v1.2.0
[1.1.0]: ../../releases/tag/v1.1.0
[1.0.0]: ../../releases/tag/v1.0.0

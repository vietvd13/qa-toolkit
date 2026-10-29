# Nhật ký thay đổi

Ghi theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/), đánh số theo [Semantic Versioning](https://semver.org/lang/vi/).

## [Chưa phát hành]

### Sửa
- Kiểm thử API: dán cURL nhiều dòng (dòng kết thúc bằng `\`, vd *Copy as cURL* của Chrome, Insomnia) báo lỗi *Không hiểu phần "" (chỉ hỗ trợ một URL)* ở mỗi dòng; nay đọc đúng.

### Thay đổi
- Kiểm thử API, **dán cURL đọc được hầu hết mọi lệnh**: chỉ báo lỗi khi không có URL hoặc method không gửi được; phần tool chưa làm được thì bỏ qua kèm cảnh báo, request vẫn được tạo:
  - dòng thừa / lệnh thứ hai dán sau lệnh, nhiều URL (lấy URL đầu), cờ lạ hoặc chưa hỗ trợ (`--proxy`, `--cert`, `-o`, `-D`, `-c`, `--http3`, `--tlsv1.2`…), đọc header / body / cookie từ file, header thiếu `:`, `-u` không mật khẩu;
  - ngoặc cong ‘ ’ “ ” (dán từ Slack / Word), ký tự vô hình, dấu cách thừa sau `\`, dấu nhắc `$` / `PS C:\>`, khối ``` markdown, `/usr/bin/curl`;
  - hiểu thêm `-I/--head` (method HEAD), `--oauth2-bearer`, `--url-query`, `-F` chữ (gửi dạng x-www-form-urlencoded, có cảnh báo); URL thiếu giao thức: `localhost` / IP thêm `http://`.
- `npm run check` kiểm bộ đọc cURL với 42 mẫu thực tế (`scripts/curl-cases.js`: Chrome bash / cmd, Firefox, Postman, Insomnia, tài liệu API, PowerShell…).

## [1.6.0] - 2026-10-29

### Thêm
- Kiểm thử API, tab **Tests**:
  - nút **Run tests (số case đang bật)** ngay cạnh *Thêm case* (chuyển từ góc trên của màn request xuống);
  - pill **đạt / sai / lỗi** trên hàng *Mong đợi*: bấm để lọc theo kết quả lần chạy gần nhất;
  - **công tắc bật / tắt** case ngay trên thẻ, không cần mở form;
  - thanh hàng loạt thêm **Đổi priority**; ô *chọn tất cả* nằm ngay đầu thanh lọc;
  - banner *case cần review* gọn một dòng, có **Bật tất cả (n)** (có hoàn tác);
  - `{{biến}}` trong lý do lỗi bấm được để nhập giá trị;
  - kiểu hiển thị **Chi tiết / Gọn** (Chi tiết mặc định, nhớ theo workspace).
- Kiểm thử API: cột **Response thu gọn được** thành dải `RESPONSE · 200` để nhường chỗ cho danh sách test case; bấm Send tự mở lại.
- Kiểm thử API, cây request: rê chuột vào folder / collection hiện nút **＋ thêm request** và ⋯.
- Kiểm thử API, **Runner**:
  - thanh tiến độ xếp chồng theo kết quả (đạt / sai / lỗi) và **thời gian còn lại** ước tính khi đang chạy;
  - ô tỉ lệ đạt có **vòng chia cung** theo trạng thái; ô thời gian có thời gian phản hồi **TB · p95**;
  - tiêu đề từng request có thanh tỉ lệ nhỏ và thời gian phản hồi trung bình;
  - đã có kết quả thì cấu hình *Lần chạy tiếp theo* gập thành một dòng.

### Thay đổi
- **Responsive khi chia nhỏ màn hình** (Kiểm thử API và bộ công cụ):
  - hàng tên request không còn xuống dòng lộn xộn: nút chỉ còn icon khi hẹp; thanh URL luôn một hàng (method gọn, Send chỉ còn icon);
  - panel trái tự thành dải icon từ **≤ 840px** (trước là 760px), mở ra thành ngăn trượt;
  - rail bộ công cụ mảnh 52px khi cửa sổ ≤ 560px; chân drawer giữ các nút trên một hàng.
- Nút **Send** dùng màu tín hiệu (CTA của dòng lệnh); Run tests giữ nút mực.
- Response chưa có dữ liệu (chưa gửi / đang gửi / chặn trước khi gửi) dùng nền sáng như vùng soạn; chỉ khi có response mới dùng mặt hiển thị than chì.
- Thẻ test case: case đang tắt mờ + viền đứt; điều kiện sai không lặp lại.
- Panel trái tối giản: tab khu vực bỏ gạch chân cam; ô environment thành *● Env: DEV* (bỏ dòng nhãn); mục đang chọn đổi màu đoạn đường dẫn hướng của chính nó thay cho vạch rời ở mép; nhãn method rộng cố định để tên request thẳng một trục; số test case nhường chỗ cho nút ⋯ khi rê chuột; chân panel gọn hơn.
- Thanh cuộn mảnh 6px, chỉ hiện khi rê chuột vào vùng cuộn.

### Sửa
- Danh sách xổ của ô chọn (vd environment) **không đọc được ở chế độ tối** trên Windows: chữ sáng trên nền trắng.

## [1.5.0] - 2026-10-28

### Thay đổi
- Hệ thiết kế mới **Dao động ký** cho cả bộ công cụ, thay *Feminine Work OS*:
  - vỏ máy xám, mặt hiển thị than chì cho điều hướng và vùng đọc kết quả, **một màu tín hiệu** (cam);
  - nút chính màu mực; màu tín hiệu chỉ dành cho mục đang chọn, biến `{{…}}`, vạch đo, vòng focus;
  - nhãn trạng thái viền mảnh, số liệu (status code, thời gian, số đếm, KPI) dùng mono;
  - font Be Vietnam Pro (giao diện), JetBrains Mono (mã, URL, số liệu), Chakra Petch (nhãn in hoa, số đo lớn); icon Material Symbols Outlined.
- **Bỏ bảng Giao diện** (tự chọn màu chủ đạo / màu phụ): màu cố định theo hệ thiết kế. Chế độ màu chỉ còn **Sáng / Tối** (lần đầu theo máy), một nút bấm để đổi.
- Control dùng chung vẽ lại: ô nhập có vòng focus mềm, select / checkbox / radio vẽ lại; hộp thoại có nền mờ.
- Control mượt hơn: mọi ô nhập, select, nút, thanh URL, ô tìm dùng **một kiểu viền** (1px `--line-strong` + `--shadow-xs`) và **một kiểu focus** (viền `--focus` + vòng `--ring`); bỏ viền 1.5px (bị răng cưa ở tỉ lệ màn hình 125% / 150%) và hiệu ứng lún nửa pixel làm nhoè chữ; nút chính hover nhạt dần thay vì pha cam; chuyển trạng thái 150ms cho nút, tab, chip, segmented.
- Token gọn trong `shared/theme.css`: `--bg*`, `--fg*`, `--line*`, `--ink-*` (mặt hiển thị), `--accent*`, `--ok/--warn/--bad/--info`, `--m-*` (màu method HTTP), `--disp`, `--fs-*`, `--h-*`, `--rad-*`, kèm quy tắc dùng. Tên cũ vẫn chạy (alias).
- Bộ công cụ: bỏ thanh đầu trang. Điều hướng, nút Sáng / Tối, cập nhật nằm trên **rail** than chì bên trái; ô tìm công cụ chuyển vào trang chủ (Ctrl K từ bất kỳ đâu). Thẻ công cụ nhấc lên khi rê chuột, hiện lần lượt khi mở trang.
- Thanh bên làm lại:
  - rail bộ công cụ: đầu rail chỉ còn bảng tên (logo · tên · phiên bản), nút **Tìm công cụ** (Ctrl K; khi thu gọn là icon trơn), mỗi công cụ là một kênh `CH01`, `CH02`… dưới nhóm *Kênh*; chân rail gọn thành một hàng icon (Sáng / Tối · Kiểm tra cập nhật · Mã nguồn · Thu gọn), có bản mới thì hiện thẻ viền tín hiệu ngay trên; bỏ nhóm thu / mở;
  - panel Kiểm thử API nền sáng trọn vẹn (than chì chỉ còn ở rail và Response): công tắc khu vực dạng segmented chữ thường, ô environment như ô nhập (PRODUCTION viền + nền đỏ); nút Dán cURL / Tạo mới gom thành cụm; panel hẹp tự ẩn gợi ý Ctrl K để ô tìm không bị cắt chữ; cây có đường dẫn hướng theo cấp, tiêu đề nhóm có vạch kẻ, mục đang chọn có vạch tín hiệu sát mép như rail.
- Kiểm thử API làm lại giao diện:
  - không còn thanh ứng dụng: khu vực (Requests · Env · Runner), environment, tìm kiếm, trạng thái lưu, hướng dẫn và menu workspace nằm trong panel trái; panel thu gọn thành dải icon; thanh bên của bộ công cụ tự thu khi mở tool;
  - màn request chia trái / phải: cấu hình và test case bên trái, **Response trên mặt hiển thị than chì** bên phải (status số lớn, thời gian, kích thước; kéo đổi độ rộng);
  - tab **Tests** đứng đầu. Mỗi test case là một thẻ viết điều kiện thành câu (“Status là 201”, “body.id có kiểu số”), có kết quả lần chạy gần nhất ngay trên thẻ: vạch màu, dòng sai ghi “→ nhận 500”, bấm ĐẠT / SAI để mở evidence;
  - **Runner** đưa kết quả lên đầu: dải chỉ số (tỉ lệ đạt, Pass / Fail / Error / Skipped, thời gian), **biểu đồ vạch** mỗi case một vạch (cao = thời gian phản hồi, bấm để mở evidence), danh sách gom theo request với một câu “mong đợi → nhận” mỗi dòng;
  - bớt chữ: mẹo mặc định tắt (bật trong **Hướng dẫn → Hiện mẹo ngay trong giao diện**), bỏ đoạn mô tả dưới tiêu đề, gộp nhập Excel / AI / JSON vào menu ⋯ và dòng *Thêm case*.

### Sửa
- Kiểm thử API: chữ tô màu `{{biến}}` lệch lên trên trong ô URL và cột Value.
- Kiểm thử API: nút chính trên mặt hiển thị Response (vd *Cho phép host*) dùng nền cam chữ trắng, thiếu tương phản (≈3:1 sáng, ≈2.6:1 tối); nay theo quy tắc nút chính màu mực.
- Kiểm thử API: hai nút khi chưa có collection (Tạo collection · Dán cURL) xếp lệch độ rộng; nay rộng bằng nhau.
- Đồng bộ token: Kiểm tra Redirect bỏ tên token cũ (`--text-*`, `--shadow*`), cỡ chữ lẻ (11.5 / 12.5px) về thang `--fs-*`, số đo lớn dùng `--disp`; độ đậm chữ viết bằng số đổi sang `--fw-*`, màu `#fff` viết cứng đổi sang token ở cả bộ.

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

[Chưa phát hành]: ../../compare/v1.6.0...HEAD
[1.6.0]: ../../releases/tag/v1.6.0
[1.5.0]: ../../releases/tag/v1.5.0
[1.4.0]: ../../releases/tag/v1.4.0
[1.3.0]: ../../releases/tag/v1.3.0
[1.2.0]: ../../releases/tag/v1.2.0
[1.1.0]: ../../releases/tag/v1.1.0
[1.0.0]: ../../releases/tag/v1.0.0

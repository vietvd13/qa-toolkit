// UI · Kiểm thử API — hướng dẫn trong giao diện: drawer Hướng dẫn (chủ đề + tìm kiếm), checklist "Bắt đầu nhanh"
// tính từ dữ liệu thật của workspace, nút ? theo ngữ cảnh (data-help="chủ-đề"), mẹo có thể ẩn, gợi ý bước tiếp theo
// sau khi Send, file Excel mẫu. Không chứa nghiệp vụ.
(() => {
  const { $, esc, toast } = Ui;
  const App = window.App;
  const S = App.state;
  const ui = () => App.W.meta.ui;
  const saveUi = () => App.W.saveMeta();

  // ================= NỘI DUNG =================
  const kbd = k => `<kbd>${k}</kbd>`;
  const TOPICS = [
    { id: 'start', icon: 'rocket_launch', title: 'Bắt đầu trong 3 phút', html: `
      <p>Công cụ giống Postman nhưng gọn cho QA: <b>gửi thử một request</b>, <b>lưu lại</b>, thêm <b>test case</b> không cần code, rồi <b>chạy lại bất cứ lúc nào</b> và xuất báo cáo Excel.</p>
      <div id="helpChecklist"></div>
      <h4>Bố cục</h4>
      <ul>
        <li><b>Thanh trái:</b> cây <b>Collection › Folder › Request</b>. Request mới chưa lưu nằm ở mục <i>Chưa lưu</i>.</li>
        <li><b>Thanh trên:</b> 3 khu vực <b>Requests</b> (soạn & gửi) · <b>Environments</b> (biến, token, host) · <b>Runner</b> (chạy nhiều request, xem kết quả). Ô chọn environment ở góc phải.</li>
        <li>Mọi thay đổi <b>tự lưu</b> trên máy (góc trên hiện <i>Đã lưu</i>). Không cần tài khoản.</li>
      </ul>
      <div class="help-tip"><span class="ms sm" aria-hidden="true">lightbulb</span><span>Bấm nút <b>?</b> cạnh mỗi khu vực để mở đúng phần hướng dẫn. Phím tắt: ${kbd('?')} mở hướng dẫn, ${kbd('Ctrl')} + ${kbd('K')} tìm request, ${kbd('Ctrl')} + ${kbd('Enter')} Send.</span></div>` },
    { id: 'request', icon: 'send', title: 'Tạo & gửi request', html: `
      <h4>Cách nhanh nhất: dán cURL</h4>
      <ol>
        <li><b>Postman:</b> mở request → icon ${kbd('&lt;/&gt;')} Code → chọn <b>cURL</b> → Copy.</li>
        <li><b>Chrome DevTools:</b> ${kbd('F12')} → tab <b>Network</b> → chuột phải request → <b>Copy</b> → <b>Copy as cURL</b> (hoặc Copy as fetch).</li>
        <li>Bấm <b>Dán cURL / fetch</b> (thanh trái) → dán → xem lại các đề xuất → <b>Tạo & Send</b>.</li>
      </ol>
      <p>Tool chỉ <b>đọc chữ</b>, không chạy lệnh. Ở bước xem lại, tool đề xuất (bỏ tích nếu không muốn):</p>
      <ul>
        <li>Tắt header trình duyệt tự thêm (sec-ch-ua, user-agent…).</li>
        <li>Chuyển token / cookie viết thẳng thành biến bí mật <code>{{TOKEN}}</code>: không lộ trong báo cáo.</li>
        <li>Tách <code>https://api.dev…</code> thành <code>{{baseUrl}}</code>: đổi environment là đổi máy chủ.</li>
        <li>Cho phép gửi tới host đó (Allowed hosts).</li>
      </ul>
      <h4>Tự nhập</h4>
      <p>Nút <b>＋</b> → Request. Chọn method, nhập URL (dán URL có <code>?a=1</code> sẽ tự tách sang tab Params), thêm Headers / Body nếu cần, bấm <b>Send</b>.</p>
      <h4>Đọc response</h4>
      <ul>
        <li>Dòng đầu: <b>status</b> (xanh 2xx, đỏ 4xx/5xx), thời gian, kích thước.</li>
        <li><b>Body:</b> Pretty / Raw, ô tìm kiếm, Copy. <b>Bấm tên một field</b> để lưu giá trị đó thành biến.</li>
        <li><b>Console:</b> request thật đã gửi (token đã che), cảnh báo, log script.</li>
        <li><b>“Chưa gửi”</b> nghĩa là tool chặn trước khi gửi (thiếu biến, host chưa được phép…): đọc lý do và bấm nút ngay bên dưới để sửa.</li>
      </ul>` },
    { id: 'vars', icon: 'data_object', title: 'Biến & Environment', html: `
      <p>Viết <code>{{tên}}</code> ở bất kỳ đâu (URL, params, headers, body, Authorization). Giá trị lấy từ environment đang chọn ở thanh trên.</p>
      <table class="help-table"><tbody>
        <tr><th>Environment</th><td>DEV / STAGING / PROD… mỗi cái một bộ giá trị: <code>baseUrl</code>, <code>TOKEN</code>, header chung, host được phép. Tạo thêm tuỳ ý ở khu vực <b>Environments</b>.</td></tr>
        <tr><th>Biến secret <span class="ms sm inline-ic" aria-hidden="true">lock</span></th><td>Token, password… Bấm ổ khoá để đánh dấu. Chỉ giữ trong phiên trình duyệt (đóng trình duyệt phải nhập lại), luôn che <code>****</code> trong báo cáo, không export.</td></tr>
        <tr><th>Allowed hosts</th><td>Danh sách host được phép gửi request, chống gửi nhầm sang hệ thống khác. <code>*.example.com</code> = mọi subdomain. localhost / IP nội bộ phải ghi đúng tên.</td></tr>
        <tr><th>Globals</th><td>Biến / host dùng chung cho mọi environment.</td></tr>
        <tr><th>Collection variables</th><td>Biến riêng của một collection (mở collection → tab Variables).</td></tr>
        <tr><th>Runtime</th><td>Biến tạo ra khi chạy: lưu từ response, <code>pm.environment.set</code>. Không ghi đè environment đã lưu.</td></tr>
      </tbody></table>
      <p><b>Ưu tiên khi trùng tên:</b> Runtime › Environment › Collection › Globals.</p>
      <p><b>Thiếu biến?</b> Tool báo “Chưa có giá trị cho biến …” kèm ô nhập ngay, và gợi ý request nào sinh ra biến đó.</p>
      <p>Biến sinh sẵn: <code>{{$timestamp}}</code> <code>{{$uuid}}</code> <code>{{$randomInt}}</code> <code>{{$randomPhone}}</code> <code>{{$randomEmail}}</code>.</p>` },
    { id: 'chain', icon: 'link', title: 'Lấy token cho request sau', html: `
      <p>Ví dụ: <b>Login</b> trả về <code>access_token</code>, các request khác cần <code>Authorization: Bearer {{TOKEN}}</code>.</p>
      <ol>
        <li>Mở request <b>Login</b> → <b>Send</b>.</li>
        <li>Trong Response, <b>bấm tên field</b> <code>access_token</code> → <i>Lưu thành biến</i> → đặt tên <code>TOKEN</code>.<br><span class="muted">(Hoặc tab <b>Tests</b> → <i>Lưu biến từ response</i> → nhập <code>$.data.access_token</code>.)</span></li>
        <li>Send lại Login: giá trị vào <b>Runtime</b>, request khác dùng <code>{{TOKEN}}</code> được ngay.</li>
        <li>Đặt Authorization cho cả collection: mở collection → tab <b>Authorization</b> → Bearer Token → <code>{{TOKEN}}</code>. Request để “Kế thừa” sẽ dùng chung.</li>
      </ol>
      <div class="help-tip"><span class="ms sm" aria-hidden="true">auto_mode</span><span><b>Runner tự xếp thứ tự:</b> request dùng <code>{{TOKEN}}</code> luôn chạy sau request tạo ra TOKEN, dù trong cây nó đứng trước. Nếu Login không lấy được token, request sau <b>không bị gửi</b> (ERROR “request phụ thuộc chưa lấy được biến”).</span></div>
      <p class="muted">Login kế thừa Bearer <code>{{TOKEN}}</code> của collection mà chính nó tạo ra TOKEN thì tool tự bỏ Authorization cho Login.</p>` },
    { id: 'tests', icon: 'checklist', title: 'Test case (không cần code)', html: `
      <p>Mở request → tab <b>Tests</b>. Mỗi test case = gửi request (có thể đổi body / header) và so kết quả với mong đợi.</p>
      <h4>Thêm thủ công</h4>
      <ol>
        <li><b>Thêm case</b> → đặt tên, priority.</li>
        <li><b>HTTP status hợp lệ:</b> gõ hoặc bấm chip: <code>200, 201</code>, <code>4xx</code>… Case negative mong 400 thì ghi 400: khi API trả 400, case <b>PASS</b>.</li>
        <li><b>Kiểm tra response</b> (không bắt buộc): mỗi dòng = Nguồn · Trường · Phép so · Giá trị. Ô Trường gợi ý đường dẫn từ lần Send gần nhất.</li>
        <li><b>Nâng cao:</b> ghi đè body / header / URL riêng cho case (vd email sai định dạng).</li>
      </ol>
      <table class="help-table"><thead><tr><th>Bạn muốn kiểm</th><th>Trường</th><th>Phép so</th><th>Giá trị</th></tr></thead><tbody>
        <tr><td>Có trả id</td><td><code>$.data.id</code></td><td>tồn tại</td><td>—</td></tr>
        <tr><td>success = true</td><td><code>$.success</code></td><td>bằng</td><td><code>true</code> (kiểu true/false)</td></tr>
        <tr><td>Thông báo có chữ “thành công”</td><td><code>$.message</code></td><td>chứa</td><td><code>thành công</code></td></tr>
        <tr><td>items là mảng</td><td><code>$.data.items</code></td><td>có kiểu</td><td>mảng (array)</td></tr>
        <tr><td>status thuộc nhóm</td><td><code>$.data.status</code></td><td>thuộc danh sách</td><td><code>active, pending</code></td></tr>
        <tr><td>Tổng lớn hơn 0</td><td><code>$.data.total</code></td><td>lớn hơn</td><td><code>0</code></td></tr>
        <tr><td>Header JSON</td><td>Header <code>content-type</code></td><td>chứa</td><td><code>json</code></td></tr>
      </tbody></table>
      <p><b>Kiểu giá trị:</b> <code>123</code> (Số) khác <code>"123"</code> (Chữ). Không chắc thì để “Tự nhận”.</p>
      <p><b>NEEDS_REVIEW:</b> case nhập từ Excel / AI mà Expected chưa rõ sẽ bị <b>tắt</b>. Mở case, sửa Expected, xoá chữ NEEDS_REVIEW ở ghi chú rồi bật lại.</p>
      <p><b>Request chưa có test case</b> vẫn được Runner chạy với kiểm tra mặc định “HTTP 2xx”.</p>` },
    { id: 'excel', icon: 'table_view', title: 'Nhập test case từ Excel / AI', html: `
      <p>Tab <b>Tests</b> → <b>Nhập</b> (hoặc các thẻ khi request chưa có case). Có 3 cách:</p>
      <h4>1. Excel → JSON bằng AI (hợp với file Excel tự do)</h4>
      <ol>
        <li><b>Copy prompt</b> (prompt không chứa URL, token của bạn).</li>
        <li>Mở ChatGPT / Claude / Gemini → dán prompt → <b>đính kèm file Excel</b> → gửi.</li>
        <li>Copy JSON AI trả về → dán vào ô → <b>Kiểm tra & nạp</b>.</li>
      </ol>
      <h4>2. Upload Excel (hợp với file theo mẫu cột)</h4>
      <p>Kéo thả .xlsx / .csv. Tool tự nhận cột, cho xem trước 5 dòng; sai cột thì sửa ở <i>Column mapping</i>.</p>
      <p><button type="button" class="btn btn-sm" data-sample-xlsx><span class="ms sm" aria-hidden="true">download</span>Tải file Excel mẫu</button></p>
      <table class="help-table"><thead><tr><th>Cột</th><th>Ví dụ</th></tr></thead><tbody>
        <tr><td>TC ID</td><td><code>TC-001</code></td></tr>
        <tr><td>Group / Tên test case / Priority</td><td><code>Negative</code> · <code>Email sai định dạng</code> · <code>P1</code></td></tr>
        <tr><td>Method / Endpoint</td><td><code>POST</code> · <code>/users</code> (bỏ trống = như request)</td></tr>
        <tr><td>Request Body</td><td><code>{"email":"abc"}</code></td></tr>
        <tr><td>Expected (mỗi dòng một điều kiện)</td><td><code>status = 400</code><br><code>message contains "email"</code><br><code>data.id exists</code><br><code>time &lt;= 2000</code></td></tr>
        <tr><td>Lưu biến</td><td><code>USER_ID = data.id</code></td></tr>
      </tbody></table>
      <h4>3. Import JSON</h4>
      <p>File Test Suite JSON v1.0 (nút <i>Tải JSON mẫu</i> để xem cấu trúc).</p>
      <h4>Sau khi kiểm tra</h4>
      <p>Tool báo <b>Tổng · Hợp lệ · Cần review · Lỗi</b>. Lỗi có nút <b>Sửa case</b>. Xong bấm <b>Lưu vào request</b> (chọn thay toàn bộ hoặc thêm vào cuối; có Hoàn tác).</p>` },
    { id: 'runner', icon: 'play_circle', title: 'Runner & Preset', html: `
      <ol>
        <li>Khu vực <b>Runner</b> → chọn collection. Tích folder / request muốn chạy (không tích = cả collection).</li>
        <li>Chọn environment (mặc định: environment đang dùng).</li>
        <li>Xem khung <b>Kiểm tra trước khi chạy</b>: mục đỏ phải sửa (có nút <i>Sửa</i>, biến thiếu nhập ngay tại chỗ), mục vàng chỉ là lưu ý.</li>
        <li><b>Run</b>. Chạy trên PROD hoặc có POST / PUT / PATCH / DELETE thì phải xác nhận (nút Huỷ được chọn sẵn để tránh bấm nhầm).</li>
      </ol>
      <p>Chạy nhanh một request / folder: nút <b>Run tests</b> trong tab Tests của request (cạnh <i>Thêm case</i>), hoặc chuột phải folder → <i>Run folder</i>.</p>
      <h4>Preset: cấu hình một lần, chạy mỗi ngày</h4>
      <p>Chọn phạm vi + environment xong → <b>Lưu cấu hình thành preset</b> (vd “Smoke Test”). Lần sau chỉ cần bấm <b>Run</b> cạnh preset. Preset không lưu token.</p>
      <h4>Chế độ chạy</h4>
      <ul>
        <li><b>Tuần tự</b> (khuyên dùng): an toàn nhất.</li>
        <li><b>Song song khi an toàn:</b> chỉ các case không truyền biến cho nhau mới chạy cùng lúc.</li>
        <li>Nâng cao: timeout, nghỉ giữa request, chỉ chạy P0/P1…, dừng sớm khi case P0 lỗi, tự thử lại lỗi mạng (chỉ GET).</li>
      </ul>` },
    { id: 'results', icon: 'fact_check', title: 'Đọc kết quả & báo cáo', html: `
      <table class="help-table"><tbody>
        <tr><th><span class="badge badge-success">PASS</span></th><td>Có response, status và mọi kiểm tra đúng mong đợi.</td></tr>
        <tr><th><span class="badge badge-error">FAIL</span></th><td>Có response nhưng sai mong đợi: <b>lỗi của API cần báo dev</b>.</td></tr>
        <tr><th><span class="badge badge-warning">ERROR</span></th><td><b>Chưa kiểm thử được</b>: thiếu biến, host chưa được phép, timeout, mất mạng, script lỗi… thường là do cấu hình, sửa rồi chạy lại.</td></tr>
        <tr><th><span class="badge badge-skip">SKIPPED</span></th><td>Case đang tắt, bị lọc, hoặc bấm Stop. Không tính vào Pass rate.</td></tr>
      </tbody></table>
      <p><b>Pass rate</b> = PASS / (Tổng − SKIPPED).</p>
      <p>Bấm một dòng để mở <b>Evidence</b>: dòng kiểm tra sai lên đầu, request / response thật (token đã che), console. ${kbd('Alt')} + ${kbd('←')} ${kbd('→')} chuyển case.</p>
      <p>Sau khi chạy: <b>Chạy lại FAIL</b> / <b>Chạy lại ERROR</b> / <b>Run lại</b>. <b>Export Excel</b> (Summary, Results, Evidence) để gửi báo cáo; <b>Export ZIP</b> khi cần evidence đầy đủ không bị cắt.</p>` },
    { id: 'scripts', icon: 'code', title: 'Scripts (nâng cao)', html: `
      <p>Không bắt buộc. Dùng khi cần logic mà form không làm được: ký request, gọi API phụ, kiểm tra phức tạp. Cú pháp giống Postman.</p>
      <ul>
        <li><b>Pre-request:</b> chạy trước khi gửi. <code>pm.request.headers.upsert({ key: 'X-Id', value: '1' })</code>, <code>pm.environment.set('X', 1)</code>, <code>await pm.sendRequest(…)</code>.</li>
        <li><b>Post-response:</b> chạy sau khi nhận. <code>pm.test('có id', () =&gt; pm.expect(pm.response.json().id).to.exist)</code>: mỗi <code>pm.test</code> là một dòng kiểm tra.</li>
        <li>Bấm <b>Snippets</b> để chèn mẫu có sẵn; <b>Dry run</b> để thử Pre-request mà không gửi request chính.</li>
      </ul>
      <p class="muted">Script chạy trong sandbox không có mạng; chỉ gọi được Allowed hosts qua <code>pm.sendRequest</code>.</p>` },
    { id: 'data', icon: 'shield', title: 'Lưu trữ, sao lưu & bảo mật', html: `
      <ul>
        <li>Dữ liệu lưu <b>trên máy này</b> (trình duyệt). Extension và bản web (<code>npm run ui</code>) lưu riêng.</li>
        <li><b>Sao lưu / chuyển máy / chia sẻ cho team:</b> menu ${kbd('⋮')} → <b>Export workspace</b> → gửi file. Người nhận: <b>Import workspace</b> → <i>Gộp</i> (không đè dữ liệu đang có).</li>
        <li>File export <b>mặc định không chứa token / password</b>.</li>
        <li>Token, password, cookie, API key được che <code>****</code> trong màn hình, kết quả đã lưu và mọi file xuất.</li>
        <li>Xoá nhầm? Bấm <b>Hoàn tác</b> trên thông báo ngay sau khi xoá.</li>
      </ul>` },
    { id: 'faq', icon: 'help', title: 'Lỗi thường gặp', html: `
      <dl class="help-faq">
        <dt>“Chưa có giá trị cho biến {{baseUrl}}”</dt><dd>Environment đang chọn chưa có giá trị. Bấm <i>Nhập giá trị</i>, hoặc đổi sang environment khác ở thanh trên.</dd>
        <dt>“Host … chưa được phép” / bị chặn bởi Allowed hosts</dt><dd>Bấm <b>Cho phép</b> (thêm vào Allowed hosts của environment). Tool chỉ gửi tới host đã cho phép để tránh gọi nhầm hệ thống.</dd>
        <dt>Token mất sau khi mở lại trình duyệt</dt><dd>Cố ý: giá trị bí mật chỉ giữ trong phiên. Nhập lại ở Environments, hoặc chạy request Login trước.</dd>
        <dt>Request sau báo “phụ thuộc chưa lấy được biến”</dt><dd>Request tạo biến (vd Login) bị lỗi hoặc đường dẫn lưu biến sai. Mở evidence của Login, kiểm tra response và rule <i>Lưu biến từ response</i>.</dd>
        <dt>“Redirect … không được phép”</dt><dd>API chuyển hướng sang host khác chưa có trong Allowed hosts: thêm host đích nếu tin cậy.</dd>
        <dt>“Chrome chưa cấp quyền”</dt><dd>Bấm <b>Cấp quyền</b> rồi Send lại (xảy ra khi extension bị giới hạn quyền truy cập trang trong <code>chrome://extensions</code>).</dd>
        <dt>Case 4xx bị FAIL dù đúng là lỗi mong đợi</dt><dd>Ghi mã đó vào <i>HTTP status hợp lệ</i> của case (vd <code>400, 422</code>).</dd>
        <dt>Không gửi được file (upload)</dt><dd>multipart/form-data chưa được hỗ trợ.</dd>
      </dl>` },
    { id: 'keys', icon: 'keyboard', title: 'Phím tắt', html: `
      <table class="help-table"><tbody>
        <tr><th>${kbd('?')} hoặc ${kbd('F1')}</th><td>Mở hướng dẫn</td></tr>
        <tr><th>${kbd('Ctrl')} + ${kbd('K')}</th><td>Tìm request</td></tr>
        <tr><th>${kbd('Ctrl')} + ${kbd('Enter')}</th><td>Send request đang mở</td></tr>
        <tr><th>${kbd('F2')} / ${kbd('Delete')}</th><td>Đổi tên / xoá mục đang chọn trong cây</td></tr>
        <tr><th>${kbd('Alt')} + ${kbd('↑')} ${kbd('↓')}</th><td>Đổi thứ tự trong cây</td></tr>
        <tr><th>${kbd('Shift')} + ${kbd('F10')}</th><td>Menu thao tác của mục trong cây</td></tr>
        <tr><th>${kbd('Alt')} + ${kbd('←')} ${kbd('→')}</th><td>Case trước / sau trong Evidence</td></tr>
        <tr><th>${kbd('Esc')}</th><td>Đóng hộp thoại / drawer</td></tr>
      </tbody></table>` },
  ];

  // ================= CHECKLIST BẮT ĐẦU NHANH =================
  function steps() {
    const W = App.W;
    const nodes = Object.values(W.nodes);
    const reqs = nodes.filter(n => n.type === 'request');
    const env = W.activeEnv();
    const ob = ui().ob || {};
    return [
      { id: 'request', label: 'Tạo request đầu tiên', hint: 'Dán cURL từ Postman / DevTools', done: reqs.length > 0, act: 'paste', btn: 'Dán cURL' },
      { id: 'send', label: 'Send và xem response', hint: 'Ctrl + Enter', done: !!ob.sent, act: 'send', btn: 'Mở request' },
      { id: 'save', label: 'Lưu vào collection', hint: 'Gom request theo dự án để chạy lại', done: reqs.some(n => n.parentId), act: 'save', btn: 'Lưu' },
      { id: 'env', label: 'Cấu hình environment', hint: 'baseUrl, token, host được phép', done: !!env && env.vars.some(v => v.key && v.value) && !!ApiPolicy.parseList(W.allowHosts(env.id)).length, act: 'env', btn: 'Mở' },
      { id: 'tests', label: 'Thêm test case', hint: 'Form, Excel hoặc AI', done: reqs.some(n => W.suite(n.id)), act: 'tests', btn: 'Thêm' },
      { id: 'run', label: 'Chạy Runner & xem kết quả', hint: 'Export Excel để báo cáo', done: !!W.lastRun, act: 'run', btn: 'Mở Runner' },
      { id: 'preset', label: 'Lưu Preset để chạy lại', hint: 'Lần sau: chọn Preset → Run', done: W.presetList().length > 0, act: 'run', btn: 'Mở Runner' },
    ];
  }
  function checklistHtml({ compact = false } = {}) {
    const list = steps();
    const done = list.filter(s => s.done).length;
    const next = list.find(s => !s.done);
    return `<div class="ob${compact ? ' compact' : ''}">
      <div class="ob-h"><b>Bắt đầu nhanh</b><span class="muted small">${done}/${list.length} bước</span><span class="spacer"></span>
        ${compact ? '' : `<button type="button" class="link-btn" data-ob-hide>${ui().obHidden ? 'Hiện trên thanh trên' : 'Ẩn khỏi thanh trên'}</button>`}</div>
      <div class="ob-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${list.length}" aria-valuenow="${done}" aria-label="Tiến độ bắt đầu"><div style="width:${(done / list.length) * 100}%"></div></div>
      <ol class="ob-list">${list.map(s => `<li class="${s.done ? 'done' : s === next ? 'next' : ''}">
        <span class="ms sm ob-ic" aria-hidden="true">${s.done ? 'check_circle' : s === next ? 'radio_button_checked' : 'radio_button_unchecked'}</span>
        <span class="ob-t"><b>${esc(s.label)}</b><span class="muted small">${esc(s.hint)}</span></span>
        ${!s.done ? `<button type="button" class="btn btn-sm${s === next ? ' btn-primary' : ''}" data-ob-act="${s.act}">${esc(s.btn)}</button>` : '<span class="visually-hidden">Đã xong</span>'}
      </li>`).join('')}</ol>
      ${done === list.length ? '<p class="ok-t small ob-done"><span class="ms sm" aria-hidden="true">celebration</span> Xong! Bạn đã dùng đủ các tính năng chính.</p>' : ''}
    </div>`;
  }
  function runStep(act) {
    const W = App.W;
    const reqs = Object.values(W.nodes).filter(n => n.type === 'request');
    App.closeHelp();
    if (act === 'paste') App.pasteCurlFlow({ parentId: null });
    else if (act === 'send') { const r = reqs[0]; if (r) { App.select(r.id); setTimeout(() => $('#btnSend')?.focus(), 50); toast('Bấm Send (hoặc Ctrl + Enter) để gửi', 'info', 3500); } else App.pasteCurlFlow({ parentId: null }); }
    else if (act === 'save') { const d = W.drafts()[0] || reqs[0]; if (d) App.saveDraftTo(d.id); else App.newCollection(); }
    else if (act === 'env') App.openEnvManager(W.meta.activeEnvId);
    else if (act === 'tests') { const r = reqs.find(n => n.parentId) || reqs[0]; if (r) App.select(r.id, { tab: 'tests' }); else App.pasteCurlFlow({ parentId: null }); }
    else if (act === 'run') App.setNav('run');
  }
  App.markDone = key => { const ob = { ...(ui().ob || {}) }; if (ob[key]) return; ob[key] = true; ui().ob = ob; saveUi(); renderGuidePill(); };
  function renderGuidePill() {
    const btn = $('#btnGuide');
    if (!btn || !App.W) return;
    const list = steps();
    const done = list.filter(s => s.done).length;
    const show = !ui().obHidden && done < list.length;
    btn.classList.toggle('hidden', !show);
    btn.querySelector('.lbl').textContent = `Bắt đầu ${done}/${list.length}`;
    btn.title = `Bắt đầu nhanh: còn ${list.length - done} bước`;
  }
  App.renderGuidePill = renderGuidePill;
  App.checklistHtml = checklistHtml;

  // ================= DRAWER HƯỚNG DẪN =================
  let cur = 'start';
  function renderHelp(q = '') {
    const nq = Ui.norm(q.trim());
    const plain = html => Ui.norm(html.replace(/<[^>]+>/g, ' '));
    const list = nq ? TOPICS.filter(t => plain(t.title + ' ' + t.html).includes(nq)) : TOPICS;
    if (nq && list.length && !list.some(t => t.id === cur)) cur = list[0].id;
    $('#helpNav').innerHTML = list.map(t => `<button type="button" class="help-nav-item${t.id === cur ? ' on' : ''}" data-topic="${t.id}" aria-current="${t.id === cur}"><span class="ms sm" aria-hidden="true">${t.icon}</span>${esc(t.title)}</button>`).join('')
      || `<p class="muted small">Không tìm thấy “${esc(q)}”.</p>`;
    const t = TOPICS.find(x => x.id === cur);
    $('#helpBody').innerHTML = list.includes(t) ? `<h3 class="help-h"><span class="ms" aria-hidden="true">${t.icon}</span>${esc(t.title)}</h3>${t.html}` : '';
    const cl = $('#helpChecklist');
    if (cl) cl.innerHTML = checklistHtml();
    if (nq) highlight($('#helpBody'), q.trim());
  }
  function highlight(root, q) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) if (Ui.norm(walker.currentNode.nodeValue).includes(Ui.norm(q))) nodes.push(walker.currentNode);
    for (const n of nodes.slice(0, 50)) {
      const i = Ui.norm(n.nodeValue).indexOf(Ui.norm(q));
      if (i < 0 || i + q.length > n.nodeValue.length) continue;
      try {
        const mark = document.createElement('mark');
        const mid = n.splitText(i);
        mid.splitText(q.length);
        mark.textContent = mid.nodeValue;
        mid.replaceWith(mark);
      } catch {} // độ dài sau chuẩn hoá lệch (ký tự tổ hợp): bỏ qua tô sáng
    }
    root.querySelector('mark')?.scrollIntoView({ block: 'center' });
  }
  App.openHelp = (topic = null, opener) => {
    if (topic && TOPICS.some(t => t.id === topic)) cur = topic;
    $('#helpSearch').value = '';
    renderHelp();
    $('#helpTips').checked = !!ui().showTips;
    Ui.openDrawer($('#helpDrawer'), opener);
    $('#helpBody').scrollTop = 0;
  };
  App.closeHelp = () => { if (Ui.currentDrawer() === $('#helpDrawer')) Ui.closeDrawer({ restoreFocus: false }); };
  $('#helpNav').addEventListener('click', e => {
    const b = e.target.closest('[data-topic]');
    if (!b) return;
    cur = b.dataset.topic;
    renderHelp($('#helpSearch').value);
    $('#helpBody').scrollTop = 0;
    $(`#helpNav [data-topic="${cur}"]`)?.focus();
  });
  $('#helpSearch').addEventListener('input', Ui.debounce(e => renderHelp(e.target.value), 150));
  $('#helpDrawer').addEventListener('click', e => {
    const go = e.target.closest('[data-help-go]');
    if (go) { cur = go.dataset.helpGo; renderHelp(); }
  });

  // ================= MẸO CÓ THỂ ẨN =================
  // App.tip(id, html) → HTML hộp mẹo. Mặc định tắt cho màn hình gọn; bật trong drawer Hướng dẫn. Rỗng nếu tester đã ẩn mẹo đó.
  App.tip = (id, html, topic) => (!ui().showTips || (ui().tips || []).includes(id) ? '' : `<div class="tip" data-tip="${id}"><span class="ms sm" aria-hidden="true">lightbulb</span><span class="tip-t">${html}${topic ? ` <button type="button" class="link-btn" data-help="${topic}">Xem hướng dẫn</button>` : ''}</span><button type="button" class="icon-btn tip-x" data-tip-close="${id}" aria-label="Ẩn mẹo này" title="Ẩn mẹo này"><span class="ms sm" aria-hidden="true">close</span></button></div>`);
  // Nút ? nhỏ cạnh tiêu đề
  App.helpBtn = (topic, label = 'Hướng dẫn') => `<button type="button" class="help-q" data-help="${topic}" aria-label="${esc(label)}" title="${esc(label)}"><span class="ms sm" aria-hidden="true">help</span></button>`;

  // ================= GỢI Ý BƯỚC TIẾP THEO SAU SEND =================
  App.nextStepHtml = (n, r) => {
    if ((ui().tips || []).includes('next')) return '';
    const W = App.W;
    const acts = [];
    if (!n.parentId) acts.push(['save', 'save', 'Lưu vào collection']);
    if (!W.suite(n.id)) acts.push(['tests', 'checklist', 'Thêm test case']);
    if (!n.extract.length && r.response && /json/i.test(r.response.headers?.['content-type'] || '')) acts.push(['extract', 'bolt', 'Lưu field thành biến']);
    if (n.parentId && W.suite(n.id)) acts.push(['run', 'play_arrow', 'Run tests']);
    if (!acts.length) return '';
    return `<div class="next-steps" data-tip="next"><span class="muted small">Tiếp theo:</span>${acts.map(([a, ic, l]) => `<button type="button" class="btn btn-sm btn-ghost" data-next="${a}"><span class="ms sm" aria-hidden="true">${ic}</span>${l}</button>`).join('')}
      <button type="button" class="icon-btn tip-x" data-tip-close="next" aria-label="Ẩn gợi ý bước tiếp theo" title="Không hiện gợi ý này nữa"><span class="ms sm" aria-hidden="true">close</span></button></div>`;
  };

  function setTips(on) {
    ui().showTips = on;
    if (on) ui().tips = [];
    saveUi();
    App.refreshSelection();
    if (S.nav !== 'requests') App.setNav(S.nav);
  }
  $('#helpTips').addEventListener('change', e => setTips(e.target.checked));

  // ================= SỰ KIỆN CHUNG =================
  document.addEventListener('click', e => {
    const h = e.target.closest('[data-help]');
    if (h) { e.preventDefault(); App.openHelp(h.dataset.help, h); return; }
    if (e.target.closest('[data-sample-xlsx]')) { e.preventDefault(); sampleExcel(); return; }
    const tc = e.target.closest('[data-tip-close]');
    if (tc) {
      const id = tc.dataset.tipClose;
      ui().tips = [...new Set([...(ui().tips || []), id])];
      saveUi();
      tc.closest('[data-tip]')?.remove();
      toast('Đã ẩn. Xem lại trong Hướng dẫn (phím ?).', 'info', 3000, { label: 'Hiện lại mọi mẹo', fn: () => setTips(true) });
      return;
    }
    const ob = e.target.closest('[data-ob-act]');
    if (ob) { runStep(ob.dataset.obAct); return; }
    if (e.target.closest('[data-ob-hide]')) { ui().obHidden = !ui().obHidden; saveUi(); renderGuidePill(); renderHelp($('#helpSearch').value); return; }
    const nx = e.target.closest('[data-next]');
    if (nx) {
      const n = App.W.get(S.sel);
      if (!n) return;
      const a = nx.dataset.next;
      if (a === 'save') App.saveDraftTo(n.id);
      else if (a === 'tests') App.setRequestTab('tests');
      else if (a === 'run') App.runRequest(n.id);
      else if (a === 'extract') { $('#respBody .j-key')?.focus(); toast('Bấm vào tên một field trong Body (vd access_token) → “Lưu thành biến”', 'info', 6000); }
    }
  });
  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if (document.querySelector('.modal-bg')) return;
    if (e.key === 'F1' || (e.key === '?' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey)) { e.preventDefault(); App.openHelp(null); }
  });
  $('#btnHelp').addEventListener('click', e => App.openHelp(null, e.currentTarget));
  $('#btnGuide').addEventListener('click', e => App.openHelp('start', e.currentTarget));
  // Cập nhật tiến độ khi dữ liệu đổi
  for (const ev of ['tree', 'suite', 'vars', 'env']) App.on(ev, () => renderGuidePill());

  // ================= FILE EXCEL MẪU =================
  async function sampleExcel() {
    const H = v => ({ v, s: 'head' });
    const W = v => ({ v, s: 'wrap' });
    const rows = [
      ['TC ID', 'Group', 'Tên test case', 'Priority', 'Method', 'Endpoint', 'Headers', 'Request Body', 'Expected', 'Lưu biến'].map(H),
      ['TC-001', 'Positive', 'Tạo người dùng hợp lệ', 'P1', 'POST', '/users', '', '{"name":"Nguyen Van A","email":"{{$randomEmail}}"}', 'status = 201\ndata.id exists\ntime <= 2000', 'USER_ID = data.id'].map(W),
      ['TC-002', 'Negative', 'Email sai định dạng', 'P1', 'POST', '/users', '', '{"name":"A","email":"abc"}', 'status = 400\nmessage contains "email"', ''].map(W),
      ['TC-003', 'Negative', 'Thiếu token', 'P2', 'POST', '/users', 'Authorization:', '{"name":"A"}', 'status = 401', ''].map(W),
      ['TC-004', 'Positive', 'Xem người dùng vừa tạo', 'P2', 'GET', '/users/{{USER_ID}}', '', '', 'status = 200\ndata.name = "Nguyen Van A"', ''].map(W),
    ];
    const guide = [
      [H('Cột'), H('Cách ghi')],
      ['TC ID', 'Mã case, không trùng. Bỏ trống: tool tự đánh số.'],
      ['Group / Priority', 'Nhóm tuỳ ý. Priority: P0, P1, P2, P3 (bỏ trống = P2).'],
      ['Method / Endpoint', 'Bỏ trống = dùng method / URL của request. Endpoint bắt đầu bằng / được nối vào máy chủ của request.'],
      ['Headers', 'Mỗi dòng "Tên: giá trị". "Tên:" để trống = bỏ header đó (vd case thiếu token).'],
      ['Request Body', 'JSON. Bỏ trống = dùng body của request. Dùng được {{biến}}.'],
      ['Expected', 'Mỗi dòng một điều kiện: status = 201 · status in [400, 422] · data.id exists · message contains "abc" · data.total > 0 · data.items type array · time <= 2000'],
      ['Lưu biến', 'TEN_BIEN = data.id → case sau dùng {{TEN_BIEN}}.'],
      ['Lưu ý', 'Expected viết bằng lời (vd "báo lỗi") → case bị tắt kèm NEEDS_REVIEW để bạn kiểm tra lại. Muốn chuyển file Excel tự do, dùng cách "Excel → JSON bằng AI".'],
    ].map(r => r.map(x => (x && typeof x === 'object' ? x : W(x))));
    try {
      const blob = await Xlsx.write([{ name: 'Test cases', rows, freeze: true, cols: [10, 12, 30, 9, 9, 22, 20, 46, 40, 20] }, { name: 'Hướng dẫn', rows: guide, cols: [20, 100] }]);
      Ui.download(blob, 'qa-api-testcase-mau.xlsx');
      toast('Đã tải qa-api-testcase-mau.xlsx', 'ok', 3000);
    } catch (x) { toast('Không tạo được file mẫu: ' + x.message, 'err'); }
  }
  App.sampleExcel = sampleExcel;
})();

// Prompt A: tester copy sang AI khác (ChatGPT, Gemini, Claude…) kèm file Excel test case để nhận JSON schema v1.0.
// Không chứa token, header hay dữ liệu môi trường nào của tester. Danh sách operator/type/mode lấy từ ApiSchema để luôn
// khớp với validator (đổi schema thì prompt đổi theo).
(() => {
  const S = window.ApiSchema;
  const TEXT = `Bạn là chuyên gia QA API và chuyển đổi dữ liệu test case sang JSON để QA API Toolkit có thể chạy tự động.

NHIỆM VỤ
- Đọc toàn bộ file Excel tôi đính kèm (tất cả sheet liên quan) hoặc bảng test case tôi dán.
- Chuyển từng test case thành JSON theo schemaVersion "${S.VERSION}" mô tả bên dưới.
- Chỉ chuyển các case có dữ liệu thực tế; không biến tiêu đề nhóm, dòng trống, ghi chú tổng quát thành test case.
- KHÔNG chạy API, KHÔNG tự đặt token/API key, KHÔNG tự đoán endpoint hay nghiệp vụ ngoài tài liệu.

NGUYÊN TẮC
1. Giữ thứ tự các case, TC ID, nhóm, tên/mô tả, priority và nội dung request từ Excel. Nếu thiếu TC ID, sinh tuần tự TC-001... và bảo đảm không trùng.
2. cURL mẫu được nhập riêng trong tool; ở đây chỉ sinh requestOverride. Nếu Excel không ghi đè một thành phần request thì bỏ qua thành phần đó để kế thừa cURL.
3. Nếu có Request Body JSON, giữ nguyên kiểu dữ liệu, giá trị null/false/0, mảng, object. Nếu case cố ý gửi JSON malformed thì dùng body.mode="raw" và value là chuỗi chính xác.
4. Expected Result phải chuyển thành phép kiểm tra MÁY CÓ THỂ ĐÁNH GIÁ: HTTP statusCodes và assertions cụ thể. HTTP statusCodes bắt buộc là mảng không rỗng. Nếu Excel không nêu status code rõ ràng, KHÔNG bịa ra status: đặt case enabled=false, dùng statusCodes=[200] chỉ như placeholder để JSON hợp lệ và ghi rõ "NEEDS_REVIEW: xác nhận expected HTTP status" trong note; case đó KHÔNG được chạy trước khi sửa. Nếu tài liệu nêu nhiều mã status hợp lệ, dùng tất cả mã được nêu.
5. Nếu expected mô tả 'trả lỗi khi dữ liệu sai', đây là negative testcase: HTTP 400/422 có thể PASS nếu expected ghi cụ thể như vậy. Không mặc định 2xx = PASS.
6. Chỉ tạo assertion khi biết chính xác source/path/operator/value. Nếu kỳ vọng mô tả mơ hồ, ghi NEEDS_REVIEW ở note, KHÔNG tự phát minh JSON path hay response schema.
7. Không chèn secrets (token, password, cookie, API key). Thay bằng {{TOKEN}} / {{API_KEY}} khi đúng ngữ cảnh và báo trong note nếu có thay thế.
8. Chỉ xuất về MỘT JSON hợp lệ, KHÔNG Markdown code fence, KHÔNG diễn giải trước/sau, KHÔNG comment hoặc trailing comma.

SCHEMA BẮT BUỘC
{
  "schemaVersion": "${S.VERSION}",
  "suite": { "name": "Tên bộ test", "description": "Mô tả" },
  "cases": [
    {
      "id": "TC-001",
      "group": "Positive hoặc Negative hoặc nhóm từ Excel",
      "name": "Tên case",
      "description": "Mô tả testcase",
      "priority": "P1",
      "enabled": true,
      "requestOverride": {
        "body": { "mode": "json", "value": { "field": "value" } }
      },
      "expect": {
        "statusCodes": [200],
        "assertions": [
          { "source": "body", "path": "$.data.id", "operator": "exists" },
          { "source": "body", "path": "$.success", "operator": "eq", "value": true }
        ]
      },
      "note": ""
    }
  ]
}

QUY TẮC KIỂU DỮ LIỆU
- priority: ${S.PRIORITIES.join(', ')}. Nếu không có priority, mặc định P2 và ghi chú "Priority mặc định P2".
- requestOverride có thể bỏ qua hoặc chỉ chứa các field cần sửa: method, url, queryParams, headers, body. Headers/queryParams là object; null nghĩa là xóa key. Body.mode: ${S.BODY_MODES.join(', ')}.
- expect.statusCodes phải là danh sách mã HTTP (100-599).
- expect.assertions là mảng; có thể [] khi tài liệu chỉ đủ thông tin để kiểm tra HTTP status.
- assertion.source là "body" hoặc "header". Với body, path chỉ dùng $, $.field, $.a.b, $.items[0].id; với header, path là tên header, ví dụ content-type.
- assertion.operator trong: ${S.OPERATORS.join(', ')}.
- exists/notExists không có value; các phép khác phải có value. type.value thuộc ${S.TYPES.join(', ')}.
- Chỉ khi Excel ghi rõ thời gian phản hồi tối đa (vd "≤ 2000 ms"): thêm expect.maxTimeMs (số nguyên ms) và đổi schemaVersion thành "1.1". Không có yêu cầu thời gian thì giữ "${S.VERSION}" và không sinh maxTimeMs.
- enabled=false cho case chưa đủ dữ liệu xác minh, note bắt đầu bằng NEEDS_REVIEW.
- Không sinh field Actual Result, Status, Evidence vào JSON input: các giá trị đó chỉ được tạo sau khi runner chạy API.

Bây giờ hãy chuyển toàn bộ test case trong Excel/bảng tôi cung cấp thành JSON theo đúng yêu cầu trên.`;

  window.ApiPrompt = { TEXT };
})();

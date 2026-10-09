const ExcelJS = require('exceljs');

/**
 * Builds a styled Microsoft Excel (.xlsx) workbook for KYC requests
 * @param {Array} records 
 * @returns {ExcelJS.Workbook}
 */
async function generateKycExcelWorkbook(records = []) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SafeGlobe Compliance Platform';
  workbook.lastModifiedBy = 'Compliance Officer';
  workbook.created = new Date();
  workbook.modified = new Date();

  // ----------------------------------------------------
  // Sheet 1: Active KYC Requests Table (13 Schema Columns)
  // ----------------------------------------------------
  const sheet1 = workbook.addWorksheet('KYC Requests', {
    views: [{ state: 'frozen', ySplit: 1 }]
  });

  sheet1.columns = [
    { header: 'KYC ID', key: 'id', width: 16 },
    { header: 'Submission Date', key: 'submission_date', width: 18 },
    { header: 'Counterparty Name', key: 'counterparty_name', width: 28 },
    { header: 'Entity Type', key: 'entity_type', width: 16 },
    { header: 'Country / Flag', key: 'country', width: 15 },
    { header: 'Relationship Type', key: 'relationship_type', width: 26 },
    { header: 'Anticipated Contract Value (SGD)', key: 'contract_value', width: 32 },
    { header: 'Ongoing Monitoring', key: 'ongoing_monitoring', width: 20 },
    { header: 'Request Status', key: 'request_status', width: 18 },
    { header: 'KYC Screening Result', key: 'screening_result', width: 22 },
    { header: 'AI Result', key: 'ai_result', width: 26 },
    { header: 'DDQ Required', key: 'ddq_required', width: 15 },
    { header: 'DDQ Status', key: 'ddq_status', width: 18 },
    // Hidden audit metadata: present in the file, collapsed in the default view
    { header: 'Created By User ID', key: 'created_by_user_id', width: 18, hidden: true },
    { header: 'Created By Email', key: 'created_by_email', width: 28, hidden: true },
    { header: 'Department', key: 'created_by_department', width: 26, hidden: true },
    { header: 'Client IP Address', key: 'ip_address', width: 16, hidden: true },
    { header: 'Client Timestamp', key: 'client_timestamp', width: 24, hidden: true },
    { header: 'Last Modified By', key: 'last_modified_by', width: 24, hidden: true },
    { header: 'Triggered Policy Clause', key: 'ddq_clause', width: 36, hidden: true }
  ];

  // Header styling (Navy brand #0F172A, white text, bold)
  sheet1.getRow(1).eachCell(cell => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0F172A' }
    };
    cell.font = {
      name: 'Calibri',
      size: 11,
      bold: true,
      color: { argb: 'FFFFFFFF' }
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  sheet1.getRow(1).height = 28;

  // Add data rows
  records.forEach((r, idx) => {
    const row = sheet1.addRow({
      id: r.id,
      submission_date: r.submission_date,
      counterparty_name: r.counterparty_name,
      entity_type: r.entity_type,
      country: r.country,
      relationship_type: r.relationship_type,
      contract_value: Number(r.contract_value || 0),
      ongoing_monitoring: r.ongoing_monitoring ? 'Enabled' : 'Disabled',
      request_status: r.request_status,
      screening_result: r.screening_result,
      ai_result: r.ai_result,
      ddq_required: r.ddq_required ? 'Yes' : 'No',
      ddq_status: r.ddq_status,
      created_by_user_id: r.created_by_user_id,
      created_by_email: r.created_by_email,
      created_by_department: r.created_by_department,
      ip_address: r.ip_address,
      client_timestamp: r.client_timestamp,
      last_modified_by: r.last_modified_by,
      ddq_clause: r.ddq_clause || 'None'
    });

    row.height = 22;
    // Format contract value as currency
    const contractCell = row.getCell('contract_value');
    contractCell.numFmt = '"SGD "#,##0';

    // Zebra striping
    if (idx % 2 === 1) {
      row.eachCell(cell => {
        if (!cell.fill) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF8FAFC' }
          };
        }
      });
    }
  });

  // ----------------------------------------------------
  // Sheet 2: Audit Trail & Compliance Traceability
  // ----------------------------------------------------
  const sheet2 = workbook.addWorksheet('Audit & Traceability', {
    state: 'hidden',
    views: [{ state: 'frozen', ySplit: 1 }]
  });

  sheet2.columns = [
    { header: 'KYC ID', key: 'id', width: 16 },
    { header: 'Counterparty Name', key: 'counterparty_name', width: 28 },
    { header: 'Triggered Policy Clause', key: 'ddq_clause', width: 36 },
    { header: 'AI Rationale', key: 'ai_rationale', width: 45 },
    { header: 'Created By User ID', key: 'created_by_user_id', width: 18 },
    { header: 'Created By Email', key: 'created_by_email', width: 28 },
    { header: 'Department', key: 'created_by_department', width: 26 },
    { header: 'Client IP', key: 'ip_address', width: 16 },
    { header: 'Client Timestamp', key: 'client_timestamp', width: 24 },
    { header: 'Last Modified By', key: 'last_modified_by', width: 24 },
    { header: 'Physical Address', key: 'address', width: 36 },
    { header: 'Entity Attributes JSON', key: 'attributes', width: 40 }
  ];

  sheet2.getRow(1).eachCell(cell => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E293B' }
    };
    cell.font = {
      name: 'Calibri',
      size: 11,
      bold: true,
      color: { argb: 'FFFFFFFF' }
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  sheet2.getRow(1).height = 28;

  records.forEach(r => {
    const loc = r.location || {};
    const attrsStr = r.attributes ? JSON.stringify(r.attributes) : '';
    const row = sheet2.addRow({
      id: r.id,
      counterparty_name: r.counterparty_name,
      ddq_clause: r.ddq_clause || 'None',
      ai_rationale: r.ai_rationale || '',
      created_by_user_id: r.created_by_user_id,
      created_by_email: r.created_by_email,
      created_by_department: r.created_by_department,
      ip_address: r.ip_address,
      client_timestamp: r.client_timestamp,
      last_modified_by: r.last_modified_by,
      address: loc.address || '',
      attributes: attrsStr
    });
    row.height = 20;
  });

  return workbook;
}

module.exports = {
  generateKycExcelWorkbook
};

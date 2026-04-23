import { PdfDocument } from './interfaces';

export const MOCK_PDF_DOCUMENT: PdfDocument = {
  header: {
    logoUrl: 'src/img/square.png',
    title: 'Annual Sales & Operations Report 2024',
    description: 'Comprehensive overview of sales performance, regional metrics, and operational KPIs across all business units.',
  },

  body: [
    // ── Page 1 ──────────────────────────────────────────────────────────────
    {
      title: 'Executive Summary',
      content: [
        {
          type: 'paragraph',
          text: 'Fiscal year 2024 marked a record-breaking period for the organisation. Total revenue surpassed $48.6M, representing a 21% year-over-year increase driven by strong enterprise adoption, three successful product launches, and expansion into four new international markets. Operating margins improved by 3.2 percentage points despite increased headcount and infrastructure investment.',
        },
        {
          type: 'bulletList',
          items: [
            'Total revenue: $48.6M (+21% YoY)',
            'Gross margin: 67.4% (up from 64.2%)',
            'Net new customers: 1,240 (enterprise: 312, SMB: 928)',
            'Customer retention rate: 93.8%',
            'Employee headcount grew from 310 to 445',
            'Expanded into APAC, LATAM, MENA, and Eastern Europe',
            'Three major product releases: v3.0, v3.5, and v4.0-beta',
          ],
        },
      ],
    },

    // ── Grid examples ────────────────────────────────────────────────────────
    {
      title: 'Layout Examples — Grid Columns',
      content: [
        // 2-column equal
        { type: 'paragraph', text: '2-Column Equal Layout:', align: 'left' },
        {
          type: 'grid',
          columns: [
            {
              content: [
                { type: 'paragraph', text: 'Left Column', align: 'left' },
                { type: 'paragraph', text: 'This column uses left-aligned text. It can contain any mix of paragraphs, lists, or tables just like a regular section.', align: 'left' },
                { type: 'bulletList', items: ['Feature A', 'Feature B', 'Feature C'] },
              ],
            },
            {
              content: [
                { type: 'paragraph', text: 'Right Column', align: 'left' },
                { type: 'paragraph', text: 'This column sits alongside the left column. Both share equal width (1fr each) with a 12px gap between them.', align: 'left' },
                { type: 'bulletList', items: ['Feature D', 'Feature E', 'Feature F'] },
              ],
            },
          ],
        },

        // 3-column equal
        { type: 'paragraph', text: '3-Column Equal Layout:', align: 'left' },
        {
          type: 'grid',
          gap: '16px',
          columns: [
            {
              content: [
                { type: 'paragraph', text: 'Revenue', align: 'center' },
                { type: 'paragraph', text: '$48.6M', align: 'center' },
                { type: 'paragraph', text: '+21% YoY', align: 'center' },
              ],
            },
            {
              content: [
                { type: 'paragraph', text: 'Customers', align: 'center' },
                { type: 'paragraph', text: '1,240', align: 'center' },
                { type: 'paragraph', text: 'Net new in 2024', align: 'center' },
              ],
            },
            {
              content: [
                { type: 'paragraph', text: 'Retention', align: 'center' },
                { type: 'paragraph', text: '93.8%', align: 'center' },
                { type: 'paragraph', text: 'All tiers combined', align: 'center' },
              ],
            },
          ],
        },

        // 2-column left label / right value (invoice-style)
        { type: 'paragraph', text: '2-Column Left Label / Right Value (e.g. invoice details):', align: 'left' },
        {
          type: 'grid',
          gap: '8px',
          columns: [
            {
              width: '40%',
              align: 'left',
              content: [
                { type: 'paragraph', text: 'Invoice Number:', align: 'left' },
                { type: 'paragraph', text: 'Issue Date:', align: 'left' },
                { type: 'paragraph', text: 'Due Date:', align: 'left' },
                { type: 'paragraph', text: 'Bill To:', align: 'left' },
                { type: 'paragraph', text: 'Total Amount:', align: 'left' },
              ],
            },
            {
              width: '60%',
              align: 'right',
              content: [
                { type: 'paragraph', text: 'INV-2024-00842', align: 'right' },
                { type: 'paragraph', text: '1 April 2024', align: 'right' },
                { type: 'paragraph', text: '30 April 2024', align: 'right' },
                { type: 'paragraph', text: 'Acme Corp, 123 Main St', align: 'right' },
                { type: 'paragraph', text: '$12,450.00', align: 'right' },
              ],
            },
          ],
        },

        // 2-column wide left / narrow right sidebar
        { type: 'paragraph', text: '2-Column Wide Content + Narrow Sidebar:', align: 'left' },
        {
          type: 'grid',
          gap: '20px',
          columns: [
            {
              width: '65%',
              content: [
                { type: 'paragraph', text: 'Main Content Area', align: 'left' },
                { type: 'paragraph', text: 'This wider column holds the primary content — a detailed description, data table, or any rich content. It takes up 65% of the available width.', align: 'justify' },
                {
                  type: 'table',
                  headers: ['Item', 'Qty', 'Unit Price', 'Total'],
                  rows: [
                    ['Platform License', '5', '$1,200', '$6,000'],
                    ['Support Package', '1', '$2,400', '$2,400'],
                    ['Onboarding', '1', '$1,500', '$1,500'],
                  ],
                },
              ],
            },
            {
              width: '35%',
              align: 'left',
              content: [
                { type: 'paragraph', text: 'Sidebar Notes', align: 'left' },
                { type: 'paragraph', text: 'Use this column for callouts, notes, or supplementary information.', align: 'left' },
                { type: 'bulletList', items: ['Net 30 terms', 'Wire transfer only', 'VAT included'] },
              ],
            },
          ],
        },
      ],
    },
    {
      title: 'Q1–Q4 Regional Sales Performance',
      content: [
        {
          type: 'paragraph',
          text: 'The table below details quarterly revenue by region and sales representative, including deal count, average contract value, and attainment against quota.',
        },
        {
          type: 'table',
          headers: ['Region', 'Rep Name', 'Q1 ($K)', 'Q2 ($K)', 'Q3 ($K)', 'Q4 ($K)', 'Total ($K)', 'Quota ($K)', 'Attainment'],
          rows: [
            ['North America', 'Alice Johnson',   '820', '910', '1,050', '1,200', '3,980', '3,800', '104.7%'],
            ['North America', 'Bob Martinez',    '740', '800',   '870',   '950', '3,360', '3,200', '105.0%'],
            ['North America', 'Carol White',     '610', '680',   '720',   '810', '2,820', '2,800', '100.7%'],
            ['North America', 'David Lee',       '530', '590',   '640',   '700', '2,460', '2,500',  '98.4%'],
            ['EMEA',          'Emma Clarke',     '680', '750',   '820',   '900', '3,150', '3,000', '105.0%'],
            ['EMEA',          'Frank Müller',    '590', '640',   '700',   '780', '2,710', '2,600', '104.2%'],
            ['EMEA',          'Grace Dubois',    '510', '560',   '610',   '670', '2,350', '2,400',  '97.9%'],
            ['APAC',          'Henry Tanaka',    '420', '480',   '540',   '620', '2,060', '2,000', '103.0%'],
            ['APAC',          'Iris Chen',       '380', '430',   '490',   '560', '1,860', '1,800', '103.3%'],
            ['APAC',          'James Park',      '310', '360',   '410',   '470', '1,550', '1,500', '103.3%'],
            ['LATAM',         'Karen Souza',     '290', '330',   '380',   '440', '1,440', '1,400', '102.9%'],
            ['LATAM',         'Luis Herrera',    '260', '300',   '340',   '390', '1,290', '1,300',  '99.2%'],
            ['MENA',          'Maya Al-Rashid',  '240', '280',   '320',   '370', '1,210', '1,200', '100.8%'],
            ['MENA',          'Nour Hassan',     '210', '250',   '290',   '340', '1,090', '1,100',  '99.1%'],
            ['Eastern Europe','Oleg Petrov',     '190', '230',   '270',   '320', '1,010', '1,000', '101.0%'],
            ['Eastern Europe','Petra Novak',     '170', '210',   '250',   '300',   '930',   '900', '103.3%'],
            ['Eastern Europe','Radu Ionescu',    '150', '190',   '230',   '270',   '840',   '850',  '98.8%'],
            ['Global - Key Accts', 'Sara Kim',   '950','1,100', '1,250', '1,400', '4,700', '4,500', '104.4%'],
            ['Global - Key Accts', 'Tom Nguyen', '880','1,020', '1,150', '1,300', '4,350', '4,200', '103.6%'],
            ['Global - Key Accts', 'Uma Patel',  '820',  '950', '1,080', '1,220', '4,070', '4,000', '101.8%'],
          ],
        },
      ],
    },

    // ── Page 2 ──────────────────────────────────────────────────────────────
    {
      title: 'Product Line Revenue Breakdown',
      content: [
        {
          type: 'paragraph',
          text: 'Revenue is distributed across four core product lines. Platform subscriptions remain the dominant contributor, while Professional Services and Add-ons showed the highest growth rates in 2024.',
        },
        {
          type: 'table',
          headers: ['Product Line', 'H1 Rev ($K)', 'H2 Rev ($K)', 'Total ($K)', 'YoY Growth', 'Gross Margin', 'Churn Rate', 'NPS Score'],
          rows: [
            ['Platform – Starter',       '2,100', '2,450', '4,550', '+14%', '72%', '8.2%', '42'],
            ['Platform – Professional',  '4,800', '5,600', '10,400', '+18%', '74%', '5.1%', '51'],
            ['Platform – Enterprise',    '7,200', '8,900', '16,100', '+24%', '76%', '2.3%', '67'],
            ['Add-ons & Integrations',   '1,400', '1,900', '3,300', '+36%', '81%', '6.7%', '48'],
            ['Professional Services',    '2,600', '3,200', '5,800', '+31%', '52%', 'N/A',  '55'],
            ['Training & Certification', '1,100', '1,350', '2,450', '+22%', '68%', 'N/A',  '61'],
            ['Marketplace Listings',       '480',   '620', '1,100', '+29%', '88%', '11.4%','38'],
            ['Legacy – Maintenance',       '950',   '950', '1,900',  '0%',  '45%', '18.0%','29'],
            ['Partner Referral Revenue',   '750',   '900', '1,650', '+20%', '91%', 'N/A',  '—'],
            ['Other / One-time',           '320',   '330',   '650',  '+2%', '60%', 'N/A',  '—'],
          ],
        },
        {
          type: 'paragraph',
          text: 'Enterprise tier continues to be the highest-margin and lowest-churn segment. Investment in the Add-ons ecosystem and Professional Services capacity is planned to accelerate in 2025.',
        },
      ],
    },

    // ── Page 3 ──────────────────────────────────────────────────────────────
    {
      title: 'Operational KPIs & Engineering Metrics',
      content: [
        {
          type: 'paragraph',
          text: 'Engineering and infrastructure teams maintained strong reliability targets while shipping a record number of features. The following table summarises key operational metrics tracked across all quarters.',
        },
        {
          type: 'table',
          headers: ['Metric', 'Q1', 'Q2', 'Q3', 'Q4', 'Annual Avg', 'Target', 'Status'],
          rows: [
            ['API Uptime (%)',            '99.94', '99.97', '99.96', '99.98', '99.96', '99.95', '✅ Met'],
            ['P95 Latency (ms)',          '142',   '138',   '131',   '124',   '134',   '150',   '✅ Met'],
            ['Deployments / Week',        '18',    '21',    '24',    '27',    '22.5',  '20',    '✅ Met'],
            ['Bug Escape Rate (%)',        '1.8',   '1.5',   '1.3',   '1.1',   '1.4',  '2.0',   '✅ Met'],
            ['Mean Time to Recovery (h)', '1.2',   '0.9',   '0.8',   '0.7',   '0.9',  '1.0',   '✅ Met'],
            ['Test Coverage (%)',         '74',    '77',    '80',    '83',    '78.5',  '80',    '⚠️ Q1–Q2'],
            ['Sprint Velocity (pts)',     '210',   '225',   '238',   '252',   '231',   '220',   '✅ Met'],
            ['Open Critical Bugs',        '12',    '9',     '7',     '5',     '8.3',   '≤10',   '✅ Met'],
            ['Infra Cost / Customer ($)', '38',    '36',    '34',    '31',    '34.8',  '35',    '✅ Met'],
            ['Security Incidents',        '2',     '1',     '1',     '0',     '1.0',   '≤2',    '✅ Met'],
            ['On-call Pages / Month',     '47',    '39',    '33',    '28',    '36.8',  '≤40',   '✅ Met'],
            ['Feature Flags Active',      '84',    '91',    '103',   '117',   '98.8',  '—',     '—'],
            ['Data Processed (TB/mo)',    '1.2',   '1.5',   '1.9',   '2.4',   '1.75',  '—',     '—'],
            ['CDN Cache Hit Rate (%)',    '91.2',  '92.4',  '93.1',  '94.0',  '92.7',  '90',    '✅ Met'],
            ['Support Ticket SLA (%)',   '94.1',  '95.3',  '96.2',  '97.0',  '95.7',  '95',    '✅ Met'],
          ],
        },
        {
          type: 'bulletList',
          items: [
            'All primary SLAs met or exceeded for the full year',
            'Test coverage target missed in Q1 and Q2 — remediated by Q3 with new CI gates',
            'Infrastructure cost per customer reduced by 18% through autoscaling improvements',
            'Zero critical security incidents in Q4 — best quarter on record',
            'Deployment frequency increased 50% YoY with no increase in rollback rate',
          ],
        },
      ],
    },
    {
      title: '2025 Strategic Priorities',
      content: [
        {
          type: 'paragraph',
          text: 'Based on 2024 performance and market analysis, the following initiatives have been approved for 2025 investment.',
        },
        {
          type: 'bulletList',
          items: [
            'Launch AI-assisted analytics module (Q2 2025)',
            'Expand APAC sales team from 3 to 8 representatives',
            'Achieve SOC 2 Type II and ISO 27001 certifications',
            'Migrate remaining legacy infrastructure to Kubernetes',
            'Introduce usage-based pricing tier for SMB segment',
            'Open regional offices in Singapore and Dubai',
            'Target $62M ARR by end of 2025',
          ],
        },
      ],
    },
  ],

  footer: {
    text: '© 2024 Acme Corp. All rights reserved. | Confidential — Internal Use Only',
  },
};

"""Read cached cell values and formulas from every XLSX worksheet without evaluating anything."""
import json, sys, zipfile, posixpath
from xml.etree import ElementTree as ET


def read_workbook(path):
    with zipfile.ZipFile(path) as book:
        entries = book.infolist()
        if len(entries) > 2000 or sum(e.file_size for e in entries) > 100_000_000:
            raise ValueError('Workbook archive exceeds bounds')
        def xml(name):
            if book.getinfo(name).file_size > 20_000_000:
                raise ValueError('Oversized XML')
            data = book.read(name)
            if len(data) > 20_000_000 or b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():
                raise ValueError('Unsafe or oversized XML')
            return ET.fromstring(data)
        ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
        strings = []
        if 'xl/sharedStrings.xml' in book.namelist():
            strings = [''.join(x.itertext()) for x in xml('xl/sharedStrings.xml').findall('m:si', ns)]
        relationships = {r.attrib['Id']: r.attrib['Target'] for r in xml('xl/_rels/workbook.xml.rels') if r.attrib.get('TargetMode') != 'External'}
        sheets = []
        cells = 0
        for sheet in xml('xl/workbook.xml').findall('m:sheets/m:sheet', ns):
            rid = sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']
            target = relationships[rid]
            name = posixpath.normpath(target.lstrip('/') if target.startswith('/') else 'xl/' + target)
            if not name.startswith('xl/worksheets/'):
                raise ValueError('Unexpected worksheet location')
            rows = []
            for row in xml(name).findall('m:sheetData/m:row', ns):
                values = []
                for c in row.findall('m:c', ns):
                    cells += 1
                    if cells > 200_000:
                        raise ValueError('Workbook cell limit exceeded')
                    v = c.find('m:v', ns)
                    value = v.text if v is not None else None
                    if c.attrib.get('t') == 's' and value is not None:
                        value = strings[int(value)]
                    if c.attrib.get('t') == 'inlineStr':
                        inline = c.find('m:is', ns)
                        value = ''.join(inline.itertext()) if inline is not None else ''
                    formula = c.find('m:f', ns)
                    if value is not None or formula is not None:
                        values.append({'cell': c.attrib.get('r'), 'value': value, 'formula': formula.text if formula is not None else None, 'type': c.attrib.get('t', 'numeric'), 'style': c.attrib.get('s')})
                if values:
                    rows.append(values)
            sheets.append({'name': sheet.attrib['name'], 'visibility': sheet.attrib.get('state', 'visible'), 'rows': rows})
        result = {'coverage': 'All worksheet cached values and formulas, including hidden sheets. Formulas are not executed. Numeric values may be Excel date serials. Embedded charts, comments, drawings and external links are not interpreted.', 'sheets': sheets}
        output = json.dumps(result, ensure_ascii=False)
        if len(output) > 1_000_000:
            raise ValueError('Workbook text exceeds review bound')
        return output

if __name__ == '__main__':
    try:
        print(read_workbook(sys.argv[1]))
    except Exception:
        print('Workbook extraction failed validation', file=sys.stderr)
        sys.exit(1)

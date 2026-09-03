#!/usr/bin/env python3
from __future__ import annotations

import json
import tempfile
import textwrap
from collections import Counter
from pathlib import Path

import matplotlib.pyplot as plt
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    BaseDocTemplate, Frame, Image, PageBreak, PageTemplate, Paragraph,
    Spacer, Table, TableStyle,
)

BASE = Path(__file__).resolve().parent
DATA = BASE / 'dados-auditoria.json'
OUTPUT = BASE / 'relatorio-auditoria-seguranca.pdf'
PALETTE = {
    'crítica': '#B91C1C', 'alta': '#EA580C', 'média': '#D97706',
    'baixa': '#2563EB', 'forte': '#059669', 'texto': '#1E293B',
    'muted': '#64748B', 'linha': '#CBD5E1', 'painel': '#F8FAFC',
}
W, H = A4
MARGIN = 1.9 * cm


def esc(value):
    return str(value).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def wrap_pre(text, width=98):
    out = []
    for line in str(text).splitlines():
        if not line:
            out.append('')
            continue
        out.extend(textwrap.wrap(line, width=width, replace_whitespace=False, drop_whitespace=False) or [''])
    return '<br/>'.join(esc(line) for line in out)


def styles():
    s = getSampleStyleSheet()
    return {
        'cover': ParagraphStyle('cover', parent=s['Title'], fontName='Helvetica-Bold', fontSize=27, leading=32,
                                textColor=colors.HexColor('#0F172A'), alignment=0, spaceAfter=14),
        'h1': ParagraphStyle('h1x', parent=s['Heading1'], fontName='Helvetica-Bold', fontSize=18, leading=22,
                             textColor=colors.HexColor('#0F172A'), spaceAfter=10),
        'h2': ParagraphStyle('h2x', parent=s['Heading2'], fontName='Helvetica-Bold', fontSize=13, leading=17,
                             textColor=colors.HexColor('#0F172A'), spaceBefore=7, spaceAfter=5),
        'body': ParagraphStyle('bodyx', parent=s['BodyText'], fontName='Helvetica', fontSize=9.3, leading=13.2,
                               textColor=colors.HexColor(PALETTE['texto']), spaceAfter=6),
        'small': ParagraphStyle('smallx', parent=s['BodyText'], fontName='Helvetica', fontSize=8.1, leading=11,
                                textColor=colors.HexColor(PALETTE['muted']), spaceAfter=4),
        'table': ParagraphStyle('tablex', parent=s['BodyText'], fontName='Helvetica', fontSize=7.2, leading=9.4,
                                textColor=colors.HexColor(PALETTE['texto'])),
        'issue': ParagraphStyle('issuex', parent=s['BodyText'], fontName='Courier', fontSize=6.6, leading=8.7,
                                backColor=colors.HexColor('#F8FAFC'), borderColor=colors.HexColor('#94A3B8'),
                                borderWidth=.5, borderPadding=7, spaceAfter=9),
    }


class AuditDoc(BaseDocTemplate):
    def __init__(self, filename, report_name):
        super().__init__(filename, pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN,
                         topMargin=2.1*cm, bottomMargin=1.8*cm, title=report_name)
        self.report_name = report_name
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id='main')
        self.addPageTemplates(PageTemplate(id='audit', frames=frame, onPage=self.decorate))

    def decorate(self, canvas, doc):
        canvas.saveState()
        if doc.page > 1:
            canvas.setStrokeColor(colors.HexColor(PALETTE['linha']))
            canvas.line(MARGIN, H - 1.25*cm, W - MARGIN, H - 1.25*cm)
            canvas.setFillColor(colors.HexColor(PALETTE['muted']))
            canvas.setFont('Helvetica', 8)
            canvas.drawString(MARGIN, H - 1.02*cm, self.report_name)
        canvas.setFillColor(colors.HexColor(PALETTE['muted']))
        canvas.setFont('Helvetica', 8)
        canvas.drawRightString(W - MARGIN, .8*cm, f'Página {doc.page}')
        canvas.restoreState()


def charts(data, directory):
    sev = Counter(x['severidade'] for x in data['achados'])
    order = ['crítica', 'alta', 'média', 'baixa']
    nz = [(x, sev.get(x, 0)) for x in order if sev.get(x, 0)]
    donut = directory / 'severidade.png'
    plt.figure(figsize=(5.2, 3.1))
    if nz:
        plt.pie([v for _, v in nz], labels=[k.title() for k, _ in nz], autopct='%1.0f%%', startangle=90,
                colors=[PALETTE[k] for k, _ in nz], wedgeprops={'width': .42, 'edgecolor': 'white'})
    else:
        plt.pie([1], colors=['#E2E8F0'], wedgeprops={'width': .42, 'edgecolor': 'white'})
    plt.title('Achados por severidade', fontsize=12)
    plt.tight_layout(); plt.savefig(donut, dpi=170, bbox_inches='tight'); plt.close()

    bar = directory / 'categorias.png'
    names = [x['nome'] for x in data['categorias']]
    values = [x['achados'] for x in data['categorias']]
    plt.figure(figsize=(7.2, 3.7))
    bars = plt.barh(names, values)
    plt.title('Achados por categoria adaptada'); plt.xlabel('Quantidade de achados')
    plt.xlim(0, max(values + [1]) + .8)
    for b, v in zip(bars, values):
        plt.text(v + .05, b.get_y() + b.get_height()/2, str(v), va='center', fontsize=9)
    plt.tight_layout(); plt.savefig(bar, dpi=170, bbox_inches='tight'); plt.close()
    return donut, bar


def table(data, widths, header=True):
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    commands = [('GRID', (0,0), (-1,-1), .35, colors.HexColor(PALETTE['linha'])),
                ('VALIGN', (0,0), (-1,-1), 'TOP'), ('LEFTPADDING',(0,0),(-1,-1),6),
                ('RIGHTPADDING',(0,0),(-1,-1),6), ('TOPPADDING',(0,0),(-1,-1),5),
                ('BOTTOMPADDING',(0,0),(-1,-1),5)]
    if header:
        commands.append(('BACKGROUND',(0,0),(-1,0),colors.HexColor('#E2E8F0')))
    t.setStyle(TableStyle(commands)); return t


def build_story(data, donut, bar):
    S = styles(); story = []
    report_name = f"Relatório de Auditoria de Segurança — {data['projeto']}"
    story += [Spacer(1, 2.1*cm), Paragraph('SEGURANÇA DE APLICAÇÃO', S['small']), Paragraph(report_name, S['cover']),
              Paragraph(f"Data: <b>{data['data']}</b> &nbsp;&nbsp; Branch: <b>{data['branch']}</b>", S['body']),
              Spacer(1, .5*cm)]
    cover = [[Paragraph('<b>Escopo auditado</b>', S['body'])], [Paragraph(esc(data['escopo']), S['body'])],
             [Paragraph('<b>Nota metodológica</b>', S['body'])],
             [Paragraph('As cinco categorias solicitadas foram mapeadas para a stack real. Categorias sem equivalente técnico foram registradas como não aplicáveis, sem forçar achados.', S['body'])]]
    story += [table(cover, [W-2*MARGIN], header=False), Spacer(1, .6*cm), Paragraph('Stack detectada', S['h2'])]
    for k, v in data['stack'].items(): story.append(Paragraph(f'<b>{esc(k.replace("_", " ").title())}:</b> {esc(v)}', S['body']))
    story.append(PageBreak())

    counts = Counter(x['severidade'] for x in data['achados'])
    story += [Paragraph('Resumo executivo', S['h1'])]
    metrics = [['Total', 'Crítica', 'Alta', 'Média', 'Baixa'], [str(len(data['achados'])), str(counts['crítica']), str(counts['alta']), str(counts['média']), str(counts['baixa'])]]
    mt = Table(metrics, colWidths=[3.2*cm]*5)
    mt.setStyle(TableStyle([('ALIGN',(0,0),(-1,-1),'CENTER'),('FONTNAME',(0,1),(-1,1),'Helvetica-Bold'),('FONTSIZE',(0,1),(-1,1),16),('BOTTOMPADDING',(0,0),(-1,-1),5)]))
    story += [mt, Spacer(1,.3*cm), Paragraph('Foram confirmados três achados: dois médios e um baixo. O risco dominante é de confidencialidade no contexto local da extensão.', S['body']),
              Table([[Image(str(donut), 7.3*cm, 4.4*cm), Image(str(bar), 9.1*cm, 4.6*cm)]], colWidths=[7.5*cm,9.2*cm]),
              Paragraph('Resultado por categoria', S['h2'])]
    rows = [[Paragraph('<b>Categoria</b>',S['table']), Paragraph('<b>Status</b>',S['table'])]] + [[Paragraph(esc(x['nome']),S['table']), Paragraph(esc(x['status']),S['table'])] for x in data['categorias']]
    story += [table(rows,[6*cm,10.3*cm]), PageBreak()]

    story.append(Paragraph('Stack, mapeamento e cobertura', S['h1']))
    for m in data['mapeamento']:
        story += [Paragraph(esc(m['categoria']), S['h2']), Paragraph(esc(m['equivalente']), S['body'])]
    story.append(Paragraph('Cobertura efetiva', S['h2']))
    for x in data['cobertura']: story.append(Paragraph('• '+esc(x), S['body']))
    story.append(Paragraph('Não aplicável / inexistente', S['h2']))
    for x in data['nao_aplicavel']: story.append(Paragraph('• '+esc(x), S['body']))
    story.append(PageBreak())

    story += [Paragraph('Pontos fortes e pontos fracos', S['h1']), Paragraph('Pontos fortes verificados', S['h2'])]
    strong = [[Paragraph('<font color="#059669"><b>✓</b></font>',S['body']), Paragraph(f"<b>{esc(x['evidencia'])}</b><br/>{esc(x['texto'])}",S['body'])] for x in data['pontos_fortes']]
    st = table(strong,[.55*cm,15.7*cm],header=False); st.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),colors.HexColor('#F0FDF4'))]))
    story += [st, Paragraph('Pontos fracos centrais', S['h2'])]
    for f in data['achados']: story.append(Paragraph(f"• <b>{esc(f['titulo'])}</b> - {esc(f['impacto'])}",S['body']))
    story.append(PageBreak())

    story.append(Paragraph('Tabela de achados detalhados', S['h1']))
    rows = [[Paragraph('<b>Severidade</b>',S['table']),Paragraph('<b>Arquivo:linha</b>',S['table']),Paragraph('<b>Descrição</b>',S['table'])]]
    for f in data['achados']:
        chip = Table([[Paragraph(f"<b>{esc(f['severidade'].upper())}</b>", ParagraphStyle('chip',parent=S['table'],textColor=colors.white,alignment=1))]], colWidths=[1.7*cm])
        chip.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),colors.HexColor(PALETTE[f['severidade']])),('BOX',(0,0),(-1,-1),0,colors.white),('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3)]))
        location = f['linhas'] if ':' in f['linhas'] else f"{f['arquivo']}:{f['linhas']}"
        rows.append([chip,Paragraph(esc(location),S['table']),Paragraph(f"<b>{esc(f['titulo'])}</b><br/>{esc(f['descricao'])}",S['table'])])
    story.append(table(rows,[2.1*cm,5.5*cm,8.7*cm])); story.append(Spacer(1,.4*cm))
    for f in data['achados']:
        story += [Paragraph(f"{f['id']} - {esc(f['titulo'])}",S['h2']), Paragraph(f"<b>Severidade:</b> {esc(f['severidade'].title())} &nbsp; <b>Categoria:</b> {esc(f['categoria'])}",S['body']),
                  Paragraph(f"<b>Evidência:</b> {esc(f['linhas'] if ':' in f['linhas'] else f['arquivo'] + ':' + f['linhas'])}",S['body']), Paragraph(wrap_pre(f['trecho'],90),S['issue']),
                  Paragraph(f"<b>Por que é explorável:</b> {esc(f['explorabilidade'])}",S['body']), Paragraph(f"<b>Impacto:</b> {esc(f['impacto'])}",S['body']),
                  Paragraph(f"<b>Correção:</b> {esc(f['recomendacao'])}",S['body'])]
    story.append(PageBreak())

    story.append(Paragraph('Recomendações priorizadas', S['h1']))
    for r in data['recomendacoes']:
        story += [Paragraph(f"<b>{esc(r['prioridade'])}</b> - {esc(r['texto'])}",S['body']), Spacer(1,.08*cm)]
    story += [Spacer(1,.3*cm), Paragraph('Observações de segurança',S['h2']), Paragraph('Nenhuma chave real, senha, token, chave privada ou default secreto efetivo foi encontrado no código atual ou nas quatro árvores de commit revisadas. O placeholder “sk-or-...” não é uma credencial.',S['body']), PageBreak(),
              Paragraph('ISSUES PARA O GITHUB',S['h1']), Paragraph('Blocos completos em Markdown, prontos para copiar e colar.',S['body'])]
    for issue in data['issues']:
        block = f"--- ISSUE {issue['numero']} ---\nTítulo: {issue['titulo']}\nLabels sugeridas: {issue['labels']}\n\n{issue['markdown']}\n--- FIM ISSUE {issue['numero']} ---"
        story.append(Paragraph(wrap_pre(block,102),S['issue']))
    return story, report_name


def main():
    data = json.loads(DATA.read_text(encoding='utf-8'))
    with tempfile.TemporaryDirectory(prefix='ai-commit-audit-') as tmp:
        donut, bar = charts(data, Path(tmp))
        story, name = build_story(data, donut, bar)
        AuditDoc(str(OUTPUT), name).build(story)
    print(OUTPUT)


if __name__ == '__main__':
    main()

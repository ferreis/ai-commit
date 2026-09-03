# Auditoria de segurança - ai-commit

Artefatos da auditoria realizada em 03/09/2026 na branch `dev`.

## Arquivos

- `dados-auditoria.json`: dados estruturados, achados, pontos fortes e issues.
- `gerar_relatorio.py`: gerador do PDF.
- `relatorio-auditoria-seguranca.pdf`: relatório final.
- `tests/webview-xss.spec.js`: regressão Playwright para a webview.

## Regenerar em ambiente isolado

```bash
cd docs/security-audit
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
python gerar_relatorio.py
```

Nenhum segredo deve ser colocado nos artefatos da auditoria.

## Playwright

O projeto não possui frontend web nem Playwright como dependência. O teste em `tests/webview-xss.spec.js` é isolado e valida que valores de configuração/diagnóstico maliciosos não executam script na HTML produzida pela webview.

Exemplo de execução em um diretório temporário com Playwright disponível:

```bash
npx playwright test docs/security-audit/tests/webview-xss.spec.js
```

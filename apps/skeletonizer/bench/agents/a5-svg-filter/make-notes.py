# 把 results/table-*.md 填进 NOTES.tpl.md，输出 NOTES.md
t = open('NOTES.tpl.md', encoding='utf8').read()
t1 = open('results/table-steady.md', encoding='utf8').read()
t2 = open('results/table-toggle.md', encoding='utf8').read()
open('NOTES.md', 'w', encoding='utf8').write(t.replace('@@T1@@', t1).replace('@@T2@@', t2))

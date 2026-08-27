import re

with open('/home/z/my-project/filo/src/components/dashboard/main-dashboard.tsx') as f:
    content = f.read()
    s = re.sub(r'"[^"]*"', 'S', content)
    s = re.sub(r'`[^`]*`', 'T', s)
    opens = 0
    closes = 0
    for i, c in enumerate(s):
        if c == '{':
            opens += 1
        elif c == '}':
            closes += 1
    if opens != closes:
        depth = 0
        pos = 0
        for i2, c2 in enumerate(s):
            if c2 == '{':
                depth += 1
            elif c2 == '}':
                depth -= 1
                if depth < 0:
                    line = s[:i2].count(chr(10), 0)+1
                    print(f'MISSING }} at line {line}')

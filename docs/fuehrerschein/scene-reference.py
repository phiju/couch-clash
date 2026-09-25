import json,math,cairosvg,base64
SIGNS='/tmp/claude-0/-home-claude/e6dcfc7c-3309-5175-88ec-4c225abc888d/scratchpad/signs-out/signs/'
COL={'rot':'#CC3E05','blau':'#2B6CB0','grün':'#3C9A5F','gelb':'#FDBC5F'}
W=800;C=400;R=60  # half road width
ANG={'N':0,'E':90,'S':180,'W':270}  # arm direction angle (N up)
def rot(x,y,a):
    r=math.radians(a); return (C+(x-C)*math.cos(r)-(y-C)*math.sin(r), C+(x-C)*math.sin(r)+(y-C)*math.cos(r))
def sign_img(n,x,y,h=56):
    d=base64.b64encode(open(SIGNS+n+'.svg','rb').read()).decode()
    return f'<image href="data:image/svg+xml;base64,{d}" x="{x-h/2}" y="{y}" width="{h}" height="{h}" preserveAspectRatio="xMidYMin meet"/>'
def render(m):
    o=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{W}" viewBox="0 0 {W} {W}">','<rect width="800" height="800" fill="#7FB069"/>']
    # roads
    o.append(f'<rect x="{C-R-10}" y="{C-R-10}" width="{2*R+20}" height="{2*R+20}" fill="#5a5a5a" rx="8"/>')
    for a in m['arms']:
        x,y=C-R,0; o.append(f'<g transform="rotate({ANG[a]} {C} {C})"><rect x="{C-R}" y="0" width="{2*R}" height="{C-R}" fill="#5a5a5a"/><line x1="{C}" y1="0" x2="{C}" y2="{C-R-20}" stroke="#fff" stroke-width="4" stroke-dasharray="24 18"/></g>')
    pp=m.get('priorityPath')
    if pp:
        for a in pp:
            o.append(f'<g transform="rotate({ANG[a]} {C} {C})"><rect x="{C-R}" y="0" width="{2*R}" height="{C}" fill="#FDBC5F" opacity=".28"/></g>')
    # signs: at right side of each approach (driver coming from arm a drives toward centre; right-hand side)
    for a,lst in m.get('signs',{}).items():
        # in arm-local coords (arm pointing up), driver drives downward, their right side is screen-left (x<C)
        g=[f'<g transform="rotate({ANG[a]} {C} {C})">']
        y=C-R-150
        for n in lst:
            g.append(f'<g transform="rotate({-ANG[a]} {C-R-45} {y+28})">'+sign_img(n,C-R-45,y,50 if not n.startswith('10') else 44)+'</g>'); y+=52
        g.append('</g>'); o+=g
    # vehicles
    for v in m['vehicles']:
        a=v['from']; col=COL.get(v['color'],'#888')
        L={'car':70,'truck':100,'bus':110,'tram':150,'bike':40,'police':70}[v['type']]; Wd={'bike':16}.get(v['type'],40)
        # driver heading down in arm-local coords, lane = screen-left half (x in C-R..C)
        x=C-R/2; y=C-R-30-L
        arrow={'straight':'M0,0 L0,40','left':'M0,0 Q0,30 30,30','right':'M0,0 Q0,30 -30,30'}[v['turn']]
        g=f'<g transform="rotate({ANG[a]} {C} {C})"><rect x="{x-Wd/2}" y="{y}" width="{Wd}" height="{L}" rx="10" fill="{col}" stroke="#123F3C" stroke-width="3"/>'
        if v.get('siren'): g+=f'<circle cx="{x}" cy="{y+L/2}" r="9" fill="#39f"/>'
        g+=f'<path transform="translate({x},{y+L+6})" d="{arrow}" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round"/></g>'
        o.append(g)
    for p in m.get('pedestrians',[]):
        o.append(f'<g transform="rotate({ANG[p["at"]]} {C} {C})"><circle cx="{C+R+18}" cy="{C-R-40}" r="14" fill="#562512"/></g>')
    o.append('</svg>'); return '\n'.join(o)
if __name__=='__main__':
    import sys
    qs=json.load(open('fs/fuehrerschein.de.json'))
    sc=[q for q in qs if q['media'] and q['media']['kind']=='scene']
    from PIL import Image
    ims=[]
    for i in map(int,sys.argv[1:]):
        q=sc[i]; svg=render(q['media']); cairosvg.svg2png(bytestring=svg.encode(),write_to=f'/tmp/sc{i}.png',output_width=400)
        ims.append(Image.open(f'/tmp/sc{i}.png')); print(i,q['id'],q['text'],'→',q['options'][q['correctIndex']],'|',json.dumps(q['media']['vehicles'],ensure_ascii=False))
    c=Image.new('RGB',(410*len(ims),400),'white')
    for k,im in enumerate(ims): c.paste(im,(k*410,0))
    c.save('scenes.png')

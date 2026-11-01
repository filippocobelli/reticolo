# Genera un file STEP AP214 minimale (solido a parallelepipedo) per i test.
import sys

def box_step(path, w=40, d=30, h=10, name='Staffa'):
    E = []
    def add(s):
        E.append(s); return len(E)
    P = [(0,0,0),(w,0,0),(w,d,0),(0,d,0),(0,0,h),(w,0,h),(w,d,h),(0,d,h)]
    pts = [add(f"CARTESIAN_POINT('',({x:.1f},{y:.1f},{z:.1f}))") for x,y,z in P]
    verts = [add(f"VERTEX_POINT('',#{p})") for p in pts]
    edges = {}
    def edge(a, b):
        key = (min(a,b), max(a,b))
        if key not in edges:
            i, j = key
            dx, dy, dz = [P[j][k]-P[i][k] for k in range(3)]
            L = (dx*dx+dy*dy+dz*dz) ** .5
            dr = add(f"DIRECTION('',({dx/L:.6f},{dy/L:.6f},{dz/L:.6f}))")
            vec = add(f"VECTOR('',#{dr},{L:.1f})")
            line = add(f"LINE('',#{pts[i]},#{vec})")
            edges[key] = add(f"EDGE_CURVE('',#{verts[i]},#{verts[j]},#{line},.T.)")
        return edges[key], (a < b)
    faces_def = [([0,3,2,1],(0,0,-1)),([4,5,6,7],(0,0,1)),([0,1,5,4],(0,-1,0)),([1,2,6,5],(1,0,0)),([2,3,7,6],(0,1,0)),([3,0,4,7],(-1,0,0))]
    faces = []
    for loop, n in faces_def:
        oes = []
        for k in range(4):
            e, same = edge(loop[k], loop[(k+1)%4])
            oes.append(add(f"ORIENTED_EDGE('',*,*,#{e},{'.T.' if same else '.F.'})"))
        el = add("EDGE_LOOP('',(" + ",".join(f"#{o}" for o in oes) + "))")
        fb = add(f"FACE_OUTER_BOUND('',#{el},.T.)")
        nd = add(f"DIRECTION('',({n[0]:.1f},{n[1]:.1f},{n[2]:.1f}))")
        rd = add("DIRECTION('',(1.0,0.0,0.0))" if n[0] == 0 else "DIRECTION('',(0.0,1.0,0.0))")
        ax = add(f"AXIS2_PLACEMENT_3D('',#{pts[loop[0]]},#{nd},#{rd})")
        pl = add(f"PLANE('',#{ax})")
        faces.append(add(f"ADVANCED_FACE('',(#{fb}),#{pl},.T.)"))
    shell = add("CLOSED_SHELL('',(" + ",".join(f"#{f}" for f in faces) + "))")
    solid = add(f"MANIFOLD_SOLID_BREP('{name}',#{shell})")
    o = add("CARTESIAN_POINT('',(0.0,0.0,0.0))"); z = add("DIRECTION('',(0.0,0.0,1.0))"); x = add("DIRECTION('',(1.0,0.0,0.0))")
    ax0 = add(f"AXIS2_PLACEMENT_3D('',#{o},#{z},#{x})")
    lu = add("( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )")
    au = add("( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) )")
    su = add("( NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT() )")
    unc = add(f"UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),#{lu},'distance_accuracy_value','')")
    ctx = add(f"( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#{unc})) GLOBAL_UNIT_ASSIGNED_CONTEXT((#{lu},#{au},#{su})) REPRESENTATION_CONTEXT('Context','3D') )")
    rep = add(f"ADVANCED_BREP_SHAPE_REPRESENTATION('',(#{ax0},#{solid}),#{ctx})")
    appc = add("APPLICATION_CONTEXT('automotive_design')")
    add(f"APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#{appc})")
    pc = add(f"PRODUCT_CONTEXT('',#{appc},'mechanical')")
    prod = add(f"PRODUCT('{name}','{name}','',(#{pc}))")
    pdc = add(f"PRODUCT_DEFINITION_CONTEXT('part definition',#{appc},'design')")
    pdf = add(f"PRODUCT_DEFINITION_FORMATION('','',#{prod})")
    pd = add(f"PRODUCT_DEFINITION('design','',#{pdf},#{pdc})")
    pds = add(f"PRODUCT_DEFINITION_SHAPE('','',#{pd})")
    add(f"SHAPE_DEFINITION_REPRESENTATION(#{pds},#{rep})")
    with open(path, 'w') as f:
        f.write("ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('Reticolo test'),'2;1');\n")
        f.write(f"FILE_NAME('{name}.step','2026-01-01T00:00:00',('Reticolo'),(''),'','Reticolo','');\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN {{ 1 0 10303 214 1 1 1 1 }}'));\nENDSEC;\nDATA;\n")
        for i, e in enumerate(E, 1): f.write(f"#{i}={e};\n")
        f.write("ENDSEC;\nEND-ISO-10303-21;\n")

if __name__ == '__main__':
    box_step(sys.argv[1] if len(sys.argv) > 1 else '/tmp/staffa.step')

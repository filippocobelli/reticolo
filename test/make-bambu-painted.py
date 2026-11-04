# Crea un 3MF strutturato come quelli di Bambu Studio: oggetti in 3D/Objects, pittura per triangolo
# (paint_color), estrusore per oggetto in model_settings.config, colori in project_settings.config.
# Senza miniature incorporate, così Reticolo deve colorarlo da solo.
import sys, zipfile, json

def cube(s, ox=0, oy=0, oz=0):
    v = [(0,0,0),(s,0,0),(s,s,0),(0,s,0),(0,0,s),(s,0,s),(s,s,s),(0,s,s)]
    v = [(x+ox, y+oy, z+oz) for x, y, z in v]
    t = [(0,2,1),(0,3,2),(4,5,6),(4,6,7),(0,1,5),(0,5,4),(1,2,6),(1,6,5),(2,3,7),(2,7,6),(3,0,4),(3,4,7)]
    return v, t

def mesh_xml(v, t, paint=None):
    vs = '\n'.join(f'     <vertex x="{x}" y="{y}" z="{z}"/>' for x, y, z in v)
    ts = '\n'.join(f'     <triangle v1="{a}" v2="{b}" v3="{c}"' + (f' paint_color="{paint[i]}"' if paint and paint[i] else '') + '/>' for i, (a, b, c) in enumerate(t))
    return f'   <mesh>\n    <vertices>\n{vs}\n    </vertices>\n    <triangles>\n{ts}\n    </triangles>\n   </mesh>'

def main(out):
    v1, t1 = cube(20)
    paint = [None] * 12
    paint[2] = paint[3] = '8'      # faccia superiore: estrusore 2 (rosso)
    paint[4] = paint[5] = '0C'     # una faccia laterale: estrusore 3 (verde)
    v2, t2 = cube(15)
    obj1 = f'''<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <resources>
  <object id="1" p:UUID="00010000-81cb-4c03-9d28-80fed5dfa1dc" type="model">
{mesh_xml(v1, t1, paint)}
  </object>
  <object id="3" p:UUID="00030000-81cb-4c03-9d28-80fed5dfa1dc" type="model">
{mesh_xml(v2, t2)}
  </object>
 </resources>
 <build/>
</model>'''
    main_model = '''<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">
 <metadata name="Application">BambuStudio-02.03.00.70</metadata>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <metadata name="Title">Cubo dipinto</metadata>
 <resources>
  <object id="2" p:UUID="00000001-61cb-4c03-9d28-80fed5dfa1dc" type="model">
   <components>
    <component p:path="/3D/Objects/object_1.model" objectid="1" p:UUID="00010000-b206-40ff-9872-83e8017abed1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
   </components>
  </object>
  <object id="4" p:UUID="00000002-61cb-4c03-9d28-80fed5dfa1dc" type="model">
   <components>
    <component p:path="/3D/Objects/object_1.model" objectid="3" p:UUID="00030000-b206-40ff-9872-83e8017abed1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
   </components>
  </object>
 </resources>
 <build p:UUID="2c7c17d8-22b5-4d84-8835-1976022ea369">
  <item objectid="2" p:UUID="00000002-b1ec-4553-aec9-835e5b724bb4" transform="1 0 0 0 1 0 0 0 1 118 128 10" printable="1"/>
  <item objectid="4" p:UUID="00000004-b1ec-4553-aec9-835e5b724bb4" transform="1 0 0 0 1 0 0 0 1 150 128 7.5" printable="1"/>
 </build>
</model>'''
    settings = '''<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="2">
    <metadata key="name" value="Cubo dipinto"/>
    <metadata key="extruder" value="1"/>
    <part id="1" subtype="normal_part">
      <metadata key="name" value="Cubo dipinto"/>
      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
    </part>
  </object>
  <object id="4">
    <metadata key="name" value="Cubetto blu"/>
    <metadata key="extruder" value="4"/>
    <part id="3" subtype="normal_part">
      <metadata key="name" value="Cubetto blu"/>
      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
    </part>
  </object>
  <plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="plater_name" value=""/>
    <model_instance>
      <metadata key="object_id" value="2"/>
      <metadata key="instance_id" value="0"/>
    </model_instance>
    <model_instance>
      <metadata key="object_id" value="4"/>
      <metadata key="instance_id" value="0"/>
    </model_instance>
  </plate>
</config>'''
    project = json.dumps({"filament_colour": ["#F2F2F2", "#E02424", "#1DB954", "#2E6BFF"], "filament_type": ["PLA", "PLA", "PLA", "PLA"], "version": "02.03.00.70"}, indent=4)
    ct = '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n</Types>'
    rels = '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n</Relationships>'
    mrels = '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n <Relationship Target="/3D/Objects/object_1.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n</Relationships>'
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', ct)
        z.writestr('_rels/.rels', rels)
        z.writestr('3D/3dmodel.model', main_model)
        z.writestr('3D/_rels/3dmodel.model.rels', mrels)
        z.writestr('3D/Objects/object_1.model', obj1)
        z.writestr('Metadata/model_settings.config', settings)
        z.writestr('Metadata/project_settings.config', project)

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '/tmp/cubo_dipinto.3mf')

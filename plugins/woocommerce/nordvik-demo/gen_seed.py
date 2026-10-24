"""Deterministic demo data for the Nordvik WooCommerce store (our own data, safe to commit)."""
import json, os, random, datetime as dt
HERE = os.path.dirname(os.path.abspath(__file__))
random.seed(42)

# (name, brand, category, price, description, tribe affinities)
P = [
 # Outdoor & footwear
 ("Kånken Classic Backpack","Fjällräven","Bags",115,"The iconic Swedish daypack in Vinylon F.", "trail urban"),
 ("Daylite Plus Pack","Osprey","Bags",70,"20 L everyday hiking daypack.", "trail"),
 ("Waterproof Backpack Mini","Rains","Bags",95,"Matte waterproof backpack from Aarhus.", "urban"),
 ("Little America Backpack","Herschel Supply Co","Bags",120,"Mountaineering-inspired laptop backpack.", "urban"),
 ("Leather Hiking Boots","Nordvik","Footwear",159,"Waxed leather mid boots with a Vibram sole, for long days on the trail.", "trail"),
 ("1460 Smooth Leather Boots","Dr. Martens","Footwear",199,"8-eye boot with the AirWair sole.", "urban gamer"),
 ("Boston Soft Footbed Clog","Birkenstock","Footwear",145,"Suede clog with a cork-latex footbed.", "slow"),
 ("Better Sweater Fleece","Patagonia","Apparel",139,"Recycled sweater-knit fleece.", "trail slow"),
 ("Atom Hoody","Arc'teryx","Apparel",260,"Light insulated hoody for cold mornings.", "trail"),
 ("Merino Hiking Socks","Darn Tough","Apparel",26,"Vermont-made merino socks with a lifetime guarantee.", "trail"),
 ("Watch Hat Beanie","Carhartt WIP","Apparel",29,"Rib-knit beanie.", "urban gamer"),
 ("Chair One Camp Chair","Helinox","Outdoor",109,"Ultralight packable chair.", "trail"),
 ("Rechargeable Headlamp 425","BioLite","Outdoor",59,"Slim rechargeable headlamp.", "trail"),
 ("No.08 Folding Knife","Opinel","Outdoor",19,"Beechwood handle, carbon steel blade.", "trail slow"),
 ("Insulated Bottle 1L","Stanley","Outdoor",49,"Vacuum bottle that keeps coffee hot for 24 h.", "trail"),
 # Coffee & home
 ("6-Cup Pour-Over Coffeemaker","Chemex","Coffee",52,"Hand-blown glass pour-over, a 1941 design.", "slow"),
 ("Stagg EKG Electric Kettle","Fellow","Coffee",165,"Gooseneck kettle with precise temperature control.", "slow"),
 ("Single-Origin Ethiopia Beans 250 g","Nordvik","Coffee",16,"Washed Yirgacheffe, light roast, notes of jasmine and bergamot. Roasted in Madrid.", "slow"),
 ("Enamel Camp Mug","Nordvik","Coffee",18,"Speckled enamel mug for campfire coffee.", "trail slow"),
 ("Classic Wool Blanket","Pendleton","Home",229,"Jacquard wool blanket woven in Oregon.", "slow"),
 ("Baies Scented Candle","Diptyque","Home",72,"Blackcurrant leaves and Bulgarian rose.", "slow"),
 ("Emberton II Speaker","Marshall","Audio",169,"Portable speaker with 30 h battery.", "urban gamer"),
 ("AT-LP60X Turntable","Audio-Technica","Audio",149,"Fully automatic belt-drive turntable.", "slow gamer"),
 # Photo & stationery
 ("Now+ Instant Camera","Polaroid","Photo",149,"Bluetooth-connected instant camera.", "urban slow"),
 ("Instax Mini 12","Fujifilm","Photo",89,"Compact instant camera.", "urban"),
 ("Medium A5 Dotted Notebook","Leuchtturm1917","Stationery",23,"Dot grid notebook, numbered pages.", "urban slow"),
 ("Classic Notebook Large","Moleskine","Stationery",24,"Hard cover ruled notebook.", "urban"),
 # Books
 ("Into the Wild — Jon Krakauer","Anchor Books","Books",16,"Paperback. Christopher McCandless walks into the Alaskan wilderness.", "trail"),
 ("Walden — Henry David Thoreau","Penguin Classics","Books",12,"Paperback. Two years in a cabin by Walden Pond.", "slow trail"),
 ("The Kinfolk Table","Kinfolk","Books",35,"Recipes for small gatherings.", "slow"),
 ("The Hobbit — J.R.R. Tolkien","HarperCollins","Books",14,"Paperback. There and back again.", "gamer trail"),
 # Vinyl
 ("For Emma, Forever Ago — Bon Iver (LP)","Jagjaguwar","Vinyl",29,"The cabin-in-Wisconsin debut, on 180 g vinyl.", "slow trail"),
 ("Helplessness Blues — Fleet Foxes (LP)","Sub Pop","Vinyl",32,"Double LP.", "trail slow"),
 ("In Rainbows — Radiohead (LP)","XL Recordings","Vinyl",30,"180 g vinyl.", "urban gamer"),
 ("Random Access Memories — Daft Punk (LP)","Columbia","Vinyl",38,"Double LP.", "urban gamer"),
 # Video & board games
 ("Alan Wake 2 (PS5)","Remedy Entertainment","Video games",49,"Survival horror. A writer trapped in a nightmare that is rewriting reality.", "gamer"),
 ("Death Stranding Director's Cut (PS5)","Kojima Productions","Video games",39,"Cross a broken America on foot to reconnect it.", "gamer trail"),
 ("Stardew Valley (Switch)","ConcernedApe","Video games",14,"Inherit your grandfather's farm and start over.", "gamer slow"),
 ("Silent Hill 2 (PS5)","Konami","Video games",59,"Psychological horror remake of the 2001 classic.", "gamer"),
 ("Wingspan","Stonemaier Games","Board games",55,"Competitive bird-collection engine builder.", "slow gamer"),
 ("Catan","Kosmos","Board games",45,"Trade, build and settle the island of Catan.", "gamer"),
]

products = []
for i,(name,brand,cat,price,desc,tribes) in enumerate(P, start=1):
    products.append({"sku": f"NV-{100+i}", "name": name, "brand": brand, "category": cat, "price": price,
                     # Generous stock so demo visitors never hit "not enough units"; the draw
                     # itself is unchanged so customers and orders stay identical.
                     "stock": {6: 30, 10: 45, 14: 60, 25: 80, 40: 120}[random.choice([6,10,14,25,40])] if i % 11 else 0,
                     "description": desc, "_tribes": tribes.split()})

TRIBE_CITIES = {
 "trail": [("Madrid",5),("Bilbao",3),("Barcelona",2),("Berlin",1)],
 "slow":  [("Madrid",3),("Barcelona",4),("Lisbon",3),("Valencia",1)],
 "gamer": [("Madrid",4),("Barcelona",2),("Valencia",3),("Berlin",2)],
 "urban": [("Madrid",4),("Barcelona",4),("Berlin",2),("Lisbon",1)],
}
COUNTRY = {"Madrid":"ES","Barcelona":"ES","Bilbao":"ES","Valencia":"ES","Lisbon":"PT","Berlin":"DE"}
FIRST = "Lucía Hugo Martina Pablo Sofía Mateo Valeria Leo Julia Daniel Paula Álvaro Carla Diego Elena Marc Noa Iker Inés Tomás Clara Bruno Ana Joana Lena Jonas Rita Nuno Sara Adrián Irene Gael Alba Marta Raúl Lara Pol Mia Óscar Nerea".split()
LAST = "García Fernández López Martín Sánchez Romero Navarro Torres Ruiz Gil Ortega Serra Vidal Costa Silva Becker Weber Moreno Castro Prieto".split()

customers, orders = [], []
start = dt.date(2026, 7, 24)
by_tribe = {t: [p for p in products if t in p["_tribes"]] for t in TRIBE_CITIES}
for c in range(60):
    tribe = random.choices(list(TRIBE_CITIES), weights=[5,4,4,3])[0]
    city = random.choices([x for x,_ in TRIBE_CITIES[tribe]], weights=[w for _,w in TRIBE_CITIES[tribe]])[0]
    fn, ln = random.choice(FIRST), random.choice(LAST)
    cust = {"ref": f"c{c+1:03d}", "first_name": fn, "last_name": ln,
            "email": f"{fn.lower()}.{ln.lower()}{c+1}@example.com".encode("ascii","ignore").decode(),
            "city": city, "country": COUNTRY[city], "_tribe": tribe}
    customers.append(cust)
    for _ in range(random.choice([1,1,2,2,3,4])):
        pool = by_tribe[tribe] if random.random() < 0.85 else products  # some noise
        items = random.sample(pool, k=random.choice([1,1,2,2,3]))
        day = start + dt.timedelta(days=random.randint(0, 89))
        orders.append({"customer": cust["ref"], "date": day.isoformat(),
                       "items": [{"sku": p["sku"], "qty": 1} for p in items]})

orders.sort(key=lambda o: o["date"])
strip = lambda rows: [{k:v for k,v in r.items() if not k.startswith("_")} for r in rows]
json.dump(strip(products), open(os.path.join(HERE, "seed/products.json"),"w"), ensure_ascii=False, indent=1)
json.dump(strip(customers), open(os.path.join(HERE, "seed/customers.json"),"w"), ensure_ascii=False, indent=1)
json.dump(orders, open(os.path.join(HERE, "seed/orders.json"),"w"), ensure_ascii=False, indent=1)
print(len(products), "products,", len(customers), "customers,", len(orders), "orders")

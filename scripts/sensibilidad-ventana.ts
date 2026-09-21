const anticipoPct = [27.6,21.5,21.5,30.1,19.1,20.5,19.2,16.7,18.0,17.1,16.7,19.4]; // sep25..ago26
const meses = ["sep25","oct25","nov25","dic25","ene26","feb26","mar26","abr26","may26","jun26","jul26","ago26"];
console.log("Anticipo/Remuneración por mes:");
meses.forEach((m,i) => console.log(`  ${m}: ${anticipoPct[i]}%`));
const avg6 = anticipoPct.slice(-6).reduce((a,b)=>a+b,0)/6;
const avg12 = anticipoPct.reduce((a,b)=>a+b,0)/12;
console.log(`\nPromedio 6 meses (lo que usa el sistema hoy): ${avg6.toFixed(1)}%`);
console.log(`Promedio 12 meses (ventana mas larga): ${avg12.toFixed(1)}%`);
console.log(`Diferencia: ${(avg12-avg6).toFixed(1)} puntos porcentuales`);

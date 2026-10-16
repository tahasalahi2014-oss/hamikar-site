require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const services = [
  { slug:"labor-law", title:"مشاوره قانون کار", description:"مشاوره تلفنی درباره پرسش‌ها و مسائل روابط کار.", audience:"WORKER", pricingType:"QUOTE", durationMinutes:30 },
  { slug:"contract-review", title:"بررسی قرارداد و مدارک", description:"بررسی قراردادها و مستندات مرتبط با درخواست.", audience:"BOTH", pricingType:"QUOTE", durationMinutes:45 },
  { slug:"salary-benefits", title:"بررسی حقوق، مزایا و سنوات", description:"بررسی اطلاعات و مدارک مربوط به حقوق، مزایا و سنوات.", audience:"WORKER", pricingType:"QUOTE", durationMinutes:30 },
  { slug:"social-security", title:"مشاوره تأمین اجتماعی", description:"بررسی پرسش‌ها و مستندات بیمه‌ای.", audience:"BOTH", pricingType:"QUOTE", durationMinutes:30 },
  { slug:"employer-advice", title:"مشاوره کارفرمایی", description:"بررسی مسائل پرسنلی و مقررات روابط کار برای کارفرمایان.", audience:"EMPLOYER", pricingType:"QUOTE", durationMinutes:45 },
  { slug:"hr-training", title:"آموزش مدیران و منابع انسانی", description:"آموزش تخصصی متناسب با نیاز سازمان.", audience:"EMPLOYER", pricingType:"QUOTE", durationMinutes:60 }
];
async function main() {
  for (const service of services) {
    await prisma.service.upsert({ where: { slug: service.slug }, update: { title: service.title, description: service.description, audience: service.audience, pricingType: service.pricingType, durationMinutes: service.durationMinutes, active: true }, create: service });
  }
  console.log(`Seeded ${services.length} services.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());

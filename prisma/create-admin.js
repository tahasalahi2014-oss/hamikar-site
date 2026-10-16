require("dotenv").config();
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
function normalizePhone(value) {
  return String(value || "").replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[\s\-()]/g, "");
}
async function main() {
  const fullName = process.env.ADMIN_NAME;
  const phone = normalizePhone(process.env.ADMIN_PHONE);
  const password = process.env.ADMIN_PASSWORD;
  if (!fullName || phone.length < 8 || !password || password.length < 14) {
    throw new Error("Set ADMIN_NAME, ADMIN_PHONE and ADMIN_PASSWORD (at least 14 characters) in your private .env file.");
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { phone },
    update: { fullName, passwordHash, role: "ADMIN", active: true },
    create: { fullName, phone, passwordHash, role: "ADMIN", active: true },
    select: { id: true, fullName: true, phone: true, role: true }
  });
  console.log("Admin account created/updated:", user.id, user.role);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());

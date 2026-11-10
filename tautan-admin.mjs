import { terapkanTautanAdmin } from "./akun.mjs";
import { klienToko } from "./supabase-klien.mjs";

export async function muatTautanAdmin(supabase) {
  var tautan = typeof document === "undefined" ? [] : document.querySelectorAll("[data-nav-admin]");
  terapkanTautanAdmin(tautan, "");
  if (!supabase) return false;
  try {
    var session = await supabase.auth.getSession();
    var user = session && session.data && session.data.session && session.data.session.user;
    if (!user || !user.id) return false;
    var profil = await supabase.from("profiles").select("role").eq("id", user.id).single();
    var role = profil && profil.data && profil.data.role;
    return terapkanTautanAdmin(tautan, role);
  } catch (error) {
    terapkanTautanAdmin(tautan, "");
    return false;
  }
}

if (typeof document !== "undefined" && document.querySelector("[data-nav-admin]")) {
  var klien = klienToko();
  if (klien) muatTautanAdmin(klien);
}

// app/utils/pdfGenerator.js
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

/**
 * Generates a professional PDF Purchase Order given a list of items.
 * Groups items by vendor and creates separate pages/sections for each.
 *
 * @param {Array} itemsToPrint - The list of inventory items to include.
 * @param {Object} shopDetails - Contains identifying info like { shopHandle: '...' }
 */
export const generatePO = (itemsToPrint, shopDetails = {}) => {
  if (!itemsToPrint || itemsToPrint.length === 0) {
    alert("No items selected for PO.");
    return;
  }

  try {
    const doc = new jsPDF();
    const shopName = shopDetails.shopHandle
      ? shopDetails.shopHandle.toUpperCase().replace(/-/g, " ")
      : "MY STORE";

    // 1. Group items by Vendor
    const groupedItems = itemsToPrint.reduce((acc, item) => {
      const vendor = item.vendor || "Unknown Vendor";
      if (!acc[vendor]) acc[vendor] = [];
      acc[vendor].push(item);
      return acc;
    }, {});

    let yPos = 20;
    const rightMarginX = 195;

    // 2. Iterate through each vendor group
    Object.keys(groupedItems).forEach((vendor, index) => {
      // Filter to only items that actually need ordering
      const itemsToOrder = groupedItems[vendor].filter(
        (i) => i.suggestedOrderQty > 0
      );

      if (itemsToOrder.length === 0) {
        // Skip vendors with nothing to order in this batch
        return;
      }

      // Add new page for subsequent vendors
      if (index > 0) {
        doc.addPage();
        yPos = 20;
      }

      // --- PO Header Info (Top Right) ---
      const poNumber = `PO-${new Date().getFullYear()}-${Math.floor(
        1000 + Math.random() * 9000
      )}`;
      doc.setFontSize(16);
      doc.setFont("helvetica", "bold");
      doc.text("PURCHASE ORDER", rightMarginX, yPos, { align: "right" });
      yPos += 10;

      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(`PO #: ${poNumber}`, rightMarginX, yPos, { align: "right" });
      yPos += 6;
      doc.text(`Date: ${new Date().toLocaleDateString()}`, rightMarginX, yPos, {
        align: "right",
      });

      // --- Addresses (Left & Center) ---
      let addressYStart = 30;

      // SHIP TO (Left)
      doc.setFont("helvetica", "bold");
      doc.text("SHIP TO:", 14, addressYStart);
      doc.setFont("helvetica", "normal");
      addressYStart += 6;
      doc.text(shopName, 14, addressYStart);
      addressYStart += 6;
      // Placeholder addresses - you could pull this from shopify settings later if needed
      doc.text("123 Store Street", 14, addressYStart);
      addressYStart += 6;
      doc.text("City, State, Zip", 14, addressYStart);

      // VENDOR (Center-Right)
      addressYStart = 30; // Reset Y for vendor block
      const vendorX = 110;
      doc.setFont("helvetica", "bold");
      doc.text("VENDOR:", vendorX, addressYStart);
      doc.setFont("helvetica", "normal");
      addressYStart += 6;
      doc.text(vendor, vendorX, addressYStart);
      addressYStart += 6;
      doc.text("Vendor Address placeholder", vendorX, addressYStart);
      addressYStart += 6;
      doc.text("City, State, Zip", vendorX, addressYStart);

      yPos = 70; // Move down for table

      // --- Table Data Prep ---
      let vendorSubtotal = 0;

      const tableColumn = ["SKU", "Item Name", "Quantity", "Unit Cost", "Total"];
      const tableRows = itemsToOrder.map((item) => {
        const orderQty = item.suggestedOrderQty;
        const unitCost = item.cost || 0;
        const lineTotal = orderQty * unitCost;
        vendorSubtotal += lineTotal;

        return [
          item.sku || "N/A",
          // Truncate very long titles so they don't break the layout
          item.title.substring(0, 45) + (item.title.length > 45 ? "..." : ""),
          orderQty,
          `$${unitCost.toFixed(2)}`,
          `$${lineTotal.toFixed(2)}`,
        ];
      });

      // --- Generate Table ---
      autoTable(doc, {
        startY: yPos,
        head: [tableColumn],
        body: tableRows,
        theme: "plain",
        headStyles: {
          fillColor: [240, 240, 240],
          textColor: [0, 0, 0],
          fontStyle: "bold",
          lineWidth: 0.1,
          lineColor: [200, 200, 200],
        },
        styles: {
          fontSize: 9,
          cellPadding: 3,
          valign: "middle",
          lineWidth: 0.1,
          lineColor: [220, 220, 220],
        },
        columnStyles: {
          0: { cellWidth: 35 }, // SKU
          2: { halign: "center" }, // Qty center
          3: { halign: "right" }, // Cost right
          4: { halign: "right" }, // Total right
        },
      });

      yPos = doc.lastAutoTable.finalY + 10;

      // --- Totals Section (Bottom Right) ---
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");

      // Subtotal
      doc.text("Subtotal:", 160, yPos, { align: "right" });
      doc.text(`$${vendorSubtotal.toFixed(2)}`, rightMarginX, yPos, {
        align: "right",
      });
      yPos += 6;

      // Tax (Placeholder set to 0 for now)
      doc.text("Tax (0%):", 160, yPos, { align: "right" });
      doc.text("$0.00", rightMarginX, yPos, { align: "right" });
      yPos += 2;

      // Line divider
      doc.setLineWidth(0.2);
      doc.line(150, yPos, rightMarginX, yPos);
      yPos += 6;

      // Grand Total
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text("TOTAL:", 160, yPos, { align: "right" });
      doc.text(`$${vendorSubtotal.toFixed(2)}`, rightMarginX, yPos, {
        align: "right",
      });
    });

    doc.save(`PO_${new Date().toISOString().slice(0, 10)}.pdf`);
  } catch (error) {
    console.error("PDF Generation Failed:", error);
    alert("Failed to generate PDF. See console for details.");
  }
};
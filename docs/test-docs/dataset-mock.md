<!--
CONVERT TO: CSV. Suggested name: meridian-restricted-parties.csv
HOW: copy only the lines inside the code block below into a new file. Keep the header row. Save as UTF-8, comma separated.
     Do not convert the whole .md: everything outside the code block is notes.
     (.xlsx is also accepted by the upload field: paste the same rows into a sheet, one value per column.)
USE IN: Sources view > Add source > Data feed > upload the file. Or the intake "attach data feed" field.
COLUMNS THE IMPORTER READS:
  name      counterparty or vessel name (required)
  reg_no    registration number, passport number or IMO number
  country   3-letter country code
  status    decides the risk level of the record:
              contains sanction / block / sdn / banned / high / illicit / freeze  -> High (88)
              contains clean / cleared / low / verified / pass                    -> Low (15)
              anything else                                                       -> Medium (50)
  type      organisation / person / vessel
  notes     free text. No commas inside a value.
EXPECTED AFTER UPLOAD: 14 readable records. Sources > the new source > "Readable data" lists them: 4 High, 6 Medium, 4 Low.
        The Compliance Agent can cite these records when it investigates a request with a matching name.
        The dataset does not change the intake colour by itself: Approved / Pending DDQ comes from the policy rules.
ROWS 1 TO 9 match the nine intake test cases. Rows 10 to 14 are extra entries for search and "Ask Dilly" tests.
-->

# Mock dataset: Meridian restricted and cleared parties

```csv
name,reg_no,country,status,type,notes
Rachel Tan Li Wen,K4471209E,SGP,Cleared,person,Existing trainer. Screened January 2026. No findings
Budi Santoso Wirawan,C4459012,IDN,Pending review,person,New marine surveyor. Jurisdiction review required
Olumide Bakare,A09872214,NGA,High risk PEP,person,Former deputy minister. Anti-corruption inquiry open since 2022
MADRID MAERSK,9778791,DNK,Verified,vessel,Container ship. Registry details confirmed
ANDHIKA VIDYANATA,9823417,IDN,Monitor,vessel,Oil products tanker. Flag state scores below 40 on CPI
MT Black Heron,9876543,PAN,Sanctions evasion suspected,vessel,Declared IMO belongs to another vessel. AIS gaps and transfers at sea
Tembusu Office Supplies Pte Ltd,201918834K,SGP,Clean,organisation,Approved supplier since 2023
Coromandel Agri Exports Private Limited,U01100TN2014PTC098765,IND,Pending review,organisation,New rice supplier. DDQ outstanding
Mandalay Hills Resources Co. Ltd.,118765432,MMR,Blocked,organisation,State shareholder and PEP owner. Sales to a designated conglomerate
Heron Maritime Holdings SA,155708921,PAN,Sanctioned activity,organisation,Owner of MT Black Heron. Nominee shareholders
Blue Reef Ship Management FZE,SHJ-FZ-204418,ARE,Watch,organisation,Commercial manager of MT Black Heron
Bakare Maritime Advisory Ltd,RC1789234,NGA,Watch,organisation,Vehicle of Olumide Bakare. Formed after he left office
PT Samudra Vidyanata Tankers,8120017733441,IDN,Pending review,organisation,Declared owner of ANDHIKA VIDYANATA
Nordhavn Liner Services A/S,DK-38112207,DNK,Low risk,organisation,Declared operator of MADRID MAERSK
```

*Mock data for testing. Company and person names are fictional. The two vessels in rows 4 and 5 are real identities used so the IMO check passes; the notes about them are invented.*
